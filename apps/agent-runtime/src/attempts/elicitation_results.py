"""Validate server-owned elicitation results for one model resume.

Participant content may enter model context only through these exact terminal result shapes. The
runtime does not reinterpret protected A2UI outcomes, and it never logs or checkpoints response
content.
"""

import copy
import math

_OUTCOMES = {"answered", "declined", "expired", "cancelled", "failed"}


def resolve_elicitation_results(
    elicitation_results: list[object],
) -> list[dict[str, object]] | None:
    """Validate one exact result batch without consuming its pending framework correlation."""
    resolved: list[dict[str, object]] = []
    request_ids: set[str] = set()
    request_keys: set[str] = set()
    for item in elicitation_results:
        if not isinstance(item, dict):
            return None
        request_id = item.get("requestId")
        request_key = item.get("requestKey")
        outcome = item.get("outcome")
        if not isinstance(request_id, str) or not isinstance(request_key, str) or outcome not in _OUTCOMES:
            return None
        if request_id in request_ids or request_key in request_keys:
            return None
        if outcome == "answered":
            if set(item) == {"requestId", "requestKey", "outcome"}:
                # A protected A2UI answer is intentionally redacted by the server. Preserve the
                # terminal marker without inventing response content.
                result = {"requestId": request_id, "requestKey": request_key, "outcome": outcome}
            elif set(item) == {"requestId", "requestKey", "outcome", "response"} and _is_json(item.get("response")):
                result = {
                    "requestId": request_id,
                    "requestKey": request_key,
                    "outcome": outcome,
                    "response": copy.deepcopy(item["response"]),
                }
            else:
                return None
        else:
            if set(item) != {"requestId", "requestKey", "outcome"}:
                return None
            result = {"requestId": request_id, "requestKey": request_key, "outcome": outcome}
        request_ids.add(request_id)
        request_keys.add(request_key)
        resolved.append(result)
    return resolved


def _is_json(value: object) -> bool:
    """Reject direct-test objects that could not have crossed the JSON command transport."""
    if value is None or isinstance(value, (str, bool)):
        return True
    if isinstance(value, int) and not isinstance(value, bool):
        return True
    if isinstance(value, float):
        return math.isfinite(value)
    if isinstance(value, list):
        return all(_is_json(item) for item in value)
    if isinstance(value, dict):
        return all(isinstance(key, str) and _is_json(item) for key, item in value.items())
    return False
