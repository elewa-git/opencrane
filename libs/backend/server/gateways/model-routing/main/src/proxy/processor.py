"""Keep local no-forward receipts separate from ordinary proxy responses.

The pinned processor's pre-call stage precedes route_request; its error handler
permits post-call transformations, so public HTTP errors cannot prove no dispatch.
https://github.com/BerriAI/litellm/blob/790a5ce0b323c1eefa70c2df25b2780097aa3f80/litellm/proxy/common_request_processing.py
"""

import json
import time

import litellm
from fastapi import HTTPException, Request, Response
from fastapi.responses import JSONResponse
from litellm.proxy._types import ProxyException, UserAPIKeyAuth
from litellm.proxy.common_request_processing import ProxyBaseLLMRequestProcessing

from .context import ACTIVE_REQUEST, MAX_RECEIPT_BYTES, MAX_REQUEST_BYTES, RECEIPT_HEADER, LocalLimiterRejection, capture_request, signed_receipt
from .limiter import ReceiptLimiter


def _qualifiable_request(data, auth, route_type) -> bool:
    """Restrict evidence to the existing attempt-key and fixed model-request shape."""
    if type(auth) is not UserAPIKeyAuth or route_type != "acompletion":
        return False
    metadata = auth.metadata
    if not isinstance(metadata, dict) or set(metadata) != {"opencrane_scope", "opencrane_key_alias"}:
        return False
    if metadata["opencrane_scope"] != "agent-runtime-attempt" or not auth.key_alias:
        return False
    if metadata["opencrane_key_alias"] != auth.key_alias or auth.team_id is not None or auth.team_metadata:
        return False
    if not isinstance(data, dict) or auth.models != [data.get("model")]:
        return False
    allowed = {"model", "messages", "max_tokens", "n", "stream", "num_retries", "max_retries", "disable_fallbacks", "tools", "tool_choice", "parallel_tool_calls"}
    if set(data) - allowed or data.get("stream") is not False or type(data.get("n")) is not int or data["n"] != 1:
        return False
    if type(data.get("num_retries")) is not int or data["num_retries"] != 0:
        return False
    if type(data.get("max_retries")) is not int or data["max_retries"] != 0 or data.get("disable_fallbacks") is not True:
        return False
    return bool(litellm.callbacks) and type(litellm.callbacks[0]) is ReceiptLimiter


def _without_reserved_headers(response):
    if isinstance(response, Response):
        for name in list(response.headers):
            if name.lower().startswith("x-opencrane-"):
                del response.headers[name]
    return response


class ReceiptProcessor(ProxyBaseLLMRequestProcessing):
    """Sign only the owned limiter's rejection before the normal routing stage.

    A valid virtual-key authentication result must come from the existing proxy
    route. This processor neither authenticates raw credentials nor grants access.
    Ordinary and unqualified calls retain upstream processing without receipts.
    """

    async def common_processing_pre_call_logic(self, **kwargs):
        result = await super().common_processing_pre_call_logic(**kwargs)
        proof = ACTIVE_REQUEST.get()
        if proof is not None:
            proof.routing_started = True
        return result

    async def base_process_llm_request(self, **kwargs):
        request, auth = kwargs["request"], kwargs["user_api_key_dict"]
        raw_body = await request.body()
        proof = None
        if len(raw_body) <= MAX_REQUEST_BYTES:
            try:
                body_data = json.loads(raw_body)
            except (UnicodeDecodeError, ValueError):
                body_data = None
            if _qualifiable_request(body_data, auth, kwargs["route_type"]):
                proof = capture_request(request.scope["headers"], raw_body, auth.api_key, int(time.time() * 1000))

        # Upstream copies raw headers into SecretFields and forwards some x-* headers.
        # Keep the attempt secret and private coordinates out of all downstream data.
        scope = dict(request.scope)
        scope["headers"] = [
            (name, value) for name, value in scope["headers"]
            if name.lower() != b"authorization" and not name.lower().startswith(b"x-opencrane-")
        ]
        sanitized_request = Request(scope, receive=request.receive)
        sanitized_request._body = raw_body
        kwargs["request"] = sanitized_request
        token = ACTIVE_REQUEST.set(proof)
        try:
            try:
                response = await super().base_process_llm_request(**kwargs)
            except LocalLimiterRejection as error:
                if proof is None or error.owner is not proof or not proof.eligible or proof.routing_started:
                    raise
                body, mac = signed_receipt(proof, error.retry_at_epoch_ms)
                response = JSONResponse(body, status_code=429, headers={RECEIPT_HEADER: mac})
                if len(response.body) > MAX_RECEIPT_BYTES:
                    raise RuntimeError("Local rejection receipt exceeds its fixed bound") from None
                return response
            _without_reserved_headers(kwargs["fastapi_response"])
            return _without_reserved_headers(response)
        finally:
            ACTIVE_REQUEST.reset(token)

    async def _handle_llm_api_exception(self, **kwargs):
        try:
            return await super()._handle_llm_api_exception(**kwargs)
        except (ProxyException, HTTPException) as error:
            if getattr(error, "headers", None):
                error.headers = {key: value for key, value in error.headers.items() if not key.lower().startswith("x-opencrane-")}
            raise
