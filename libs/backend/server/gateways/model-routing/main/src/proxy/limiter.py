"""Extend the pinned limiter without replacing its limit or cache calculation.

The checked upstream implementation is:
https://github.com/BerriAI/litellm/blob/790a5ce0b323c1eefa70c2df25b2780097aa3f80/litellm/proxy/hooks/parallel_request_limiter_v3.py
"""

import re

from litellm.proxy.hooks.parallel_request_limiter_v3 import _PROXY_MaxParallelRequestsHandler_v3

from .context import ACTIVE_REQUEST, MAX_SAFE_INTEGER, LocalLimiterRejection


class _ObservedLimitResult(dict):
    """Keep a reset derived from this exact cache snapshot, not request metadata."""

    def __init__(self, result: dict, reset_at_epoch_ms: int | None):
        super().__init__(result)
        self.reset_at_epoch_ms = reset_at_epoch_ms


def _cache_integer(value) -> int | None:
    if type(value) is int:
        return value if 0 <= value <= MAX_SAFE_INTEGER else None
    if isinstance(value, bytes):
        try:
            value = value.decode("ascii")
        except UnicodeDecodeError:
            return None
    if isinstance(value, str) and re.fullmatch(r"0|[1-9][0-9]{0,15}", value):
        parsed = int(value)
        return parsed if parsed <= MAX_SAFE_INTEGER else None
    return None


def _snapshot_reset(result, keys, values, metadata) -> int | None:
    """Require every status to match its cache pair before accepting any reset.

    The reset is only a future opportunity to retry. New traffic may consume the
    next window too; the conversation owner must bound and reauthorize every retry.
    """
    statuses = result.get("statuses")
    if result.get("overall_code") != "OVER_LIMIT" or not isinstance(statuses, list):
        return None
    if len(keys) != len(values) or len(keys) % 2 or len(statuses) != len(keys) // 2:
        return None
    limits = {"requests": "requests_limit", "tokens": "tokens_limit", "max_parallel_requests": "max_parallel_requests_limit"}
    resets = []
    for index, status in enumerate(statuses):
        if not isinstance(status, dict):
            return None
        window_key, counter_key = keys[index * 2:index * 2 + 2]
        if not isinstance(window_key, str) or not window_key.endswith(":window"):
            return None
        facts = metadata.get(window_key)
        kind = status.get("rate_limit_type")
        if not isinstance(facts, dict) or kind not in limits or status.get("code") not in ("OK", "OVER_LIMIT"):
            return None
        if counter_key != window_key.removesuffix(":window") + ":" + kind:
            return None
        limit = _cache_integer(facts.get(limits[kind]))
        if limit is None or type(status.get("current_limit")) is not int or status["current_limit"] != limit:
            return None
        if status.get("descriptor_key") != facts.get("descriptor_key"):
            return None
        if status["code"] != "OVER_LIMIT":
            continue
        start = _cache_integer(values[index * 2])
        window = _cache_integer(facts.get("window_size"))
        counter = _cache_integer(values[index * 2 + 1])
        if start is None or window is None or window == 0 or counter is None or counter <= limit:
            return None
        reset = (start + window) * 1000
        if reset > MAX_SAFE_INTEGER:
            return None
        resets.append(reset)
    return max(resets) if resets else None


class ReceiptLimiter(_PROXY_MaxParallelRequestsHandler_v3):
    """Issue private rejection evidence only on this request's first limiter call."""

    def is_cache_list_over_limit(self, keys_to_fetch, cache_values, key_metadata):
        result = super().is_cache_list_over_limit(keys_to_fetch, cache_values, key_metadata)
        return _ObservedLimitResult(result, _snapshot_reset(result, keys_to_fetch, cache_values, key_metadata))

    async def async_pre_call_hook(self, user_api_key_dict, cache, data, call_type):
        # The pinned callback traversal skips methods inherited by a concrete class.
        proof = ACTIVE_REQUEST.get()
        if proof is not None:
            if proof.limiter_seen:
                proof.eligible = False
            proof.limiter_seen = True
            proof.limiter_running = True
        try:
            return await super().async_pre_call_hook(user_api_key_dict, cache, data, call_type)
        finally:
            if proof is not None:
                proof.limiter_running = False

    def _handle_rate_limit_error(self, response, descriptors):
        proof = ACTIVE_REQUEST.get()
        if (proof is not None and proof.eligible and proof.limiter_running and not proof.routing_started
                and type(response) is _ObservedLimitResult):
            retry_at = response.reset_at_epoch_ms
            now = int(self._get_current_time().timestamp() * 1000)
            if type(retry_at) is int and now < retry_at < proof.coordinates.deadline_epoch_ms:
                raise LocalLimiterRejection(proof, retry_at)
        return super()._handle_rate_limit_error(response, descriptors)
