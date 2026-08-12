"""Checks the shape of participant answers the server saved, before they reach the model.

Whatever the participant typed or chose enters the model's context through this module and nowhere
else, so each answer has to match one of the shapes below exactly. When the server has decided an
answer must stay hidden — an A2UI action it handled itself — this module keeps the outcome and does not
invent content to stand in for it. Answers are never logged or written to a checkpoint here.
"""

import copy
import math

# Every way the server can report that a question is finished with. A question still open has no entry
# here at all, so an unknown or missing outcome rejects the batch instead of resuming the model with a
# state it has no way to act on.
_OUTCOMES = {"answered", "declined", "expired", "cancelled", "failed"}


def resolve_elicitation_results(
    elicitation_results: list[object],
) -> list[dict[str, object]] | None:
    """Check every saved answer in one resume command and rebuild it from the fields we recognise.

    Matching answers to the model calls waiting for them is left to the caller, so that both kinds of
    result in a resume can be taken together. This function reads no registry and removes nothing.

    Called by: ``resolve_resume_results`` in ``resume_results.py``.

    Returns:
        The rebuilt answers, in the order they arrived, which is what lets the caller line each one up
        with the model call id it looked up. ``None`` when any answer in the batch is unusable.
    """
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
        # Both ids have to be unique within the batch. A repeat of either would apply one answer twice,
        # or collapse two answers onto a single waiting question.
        if request_id in request_ids or request_key in request_keys:
            return None
        if outcome == "answered":
            if set(item) == {"requestId", "requestKey", "outcome"}:
                # The server withheld the content of this answer on purpose, which it does for an A2UI
                # action it applied itself. Keep the outcome and add nothing in place of the content.
                result = {"requestId": request_id, "requestKey": request_key, "outcome": outcome}
            elif set(item) == {"requestId", "requestKey", "outcome", "response"} and _is_json(item.get("response")):
                # Copy the answer rather than keeping the command's own object. The caller still holds
                # the decoded command, and the model must not see later edits to it.
                result = {
                    "requestId": request_id,
                    "requestKey": request_key,
                    "outcome": outcome,
                    "response": copy.deepcopy(item["response"]),
                }
            else:
                return None
        else:
            # Only an answer carries content. Declined, expired, cancelled and failed are plain
            # markers, so an extra member on one of them means the result is not the shape it claims.
            if set(item) != {"requestId", "requestKey", "outcome"}:
                return None
            result = {"requestId": request_id, "requestKey": request_key, "outcome": outcome}
        request_ids.add(request_id)
        request_keys.add(request_key)
        resolved.append(result)
    return resolved


def _is_json(value: object) -> bool:
    """Check that an answer contains only values that could have arrived as JSON.

    An answer that really came over the wire was decoded from JSON, so this passes without doing
    anything. It earns its place against callers inside the process — tests and future code — that
    could otherwise pass a custom class, a set, or a not-a-number float straight into model context.
    """
    if value is None or isinstance(value, (str, bool)):
        return True
    # Python treats True and False as integers. They match the line above, and are excluded here so
    # the two cases cannot both claim the same value.
    if isinstance(value, int) and not isinstance(value, bool):
        return True
    # JSON has no not-a-number and no infinity. Letting one through would produce output that no
    # decoder on the other side can read.
    if isinstance(value, float):
        return math.isfinite(value)
    # Walk lists and objects to their leaves. The container can look right while a value inside it
    # could never have come from JSON.
    if isinstance(value, list):
        return all(_is_json(item) for item in value)
    if isinstance(value, dict):
        return all(isinstance(key, str) and _is_json(item) for key, item in value.items())
    return False
