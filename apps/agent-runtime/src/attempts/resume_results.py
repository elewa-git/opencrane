"""Resolve mixed saved tool and elicitation results as one atomic model-resume batch."""

from .elicitation_results import resolve_elicitation_results
from .pending_elicitations import consume_pending_elicitations, peek_pending_elicitations
from .pending_result_lock import PENDING_RESULT_LOCK
from .pending_tools import consume_pending_tool_calls, peek_pending_tool_calls
from .tool_results import validate_tool_results


def resolve_resume_results(
    coordinates: dict[str, object],
    tool_results: list[object],
    elicitation_results: list[object],
) -> dict[str, object] | None:
    """Validate, correlate, collision-check, and consume both result kinds atomically."""
    validated_tools = validate_tool_results(tool_results)
    validated_elicitations = resolve_elicitation_results(elicitation_results)
    if validated_tools is None or validated_elicitations is None:
        return None
    tool_ids, tool_values = validated_tools
    request_keys = [str(result["requestKey"]) for result in validated_elicitations]
    run_id = str(coordinates["runId"])
    attempt = int(coordinates["attempt"])
    with PENDING_RESULT_LOCK:
        pending_tools = peek_pending_tool_calls(run_id, attempt, tool_ids)
        elicitation_call_ids = peek_pending_elicitations(run_id, attempt, request_keys)
        if pending_tools is None or elicitation_call_ids is None:
            return None
        if set(tool_ids).intersection(elicitation_call_ids):
            return None
        resolved_elicitations = {
            call_id: result
            for call_id, result in zip(elicitation_call_ids, validated_elicitations, strict=True)
        }
        consume_pending_tool_calls(run_id, attempt, tool_ids)
        consume_pending_elicitations(run_id, attempt, request_keys)
    return {**tool_values, **resolved_elicitations}
