"""Map saved control-plane tool results into the model loop.

A ``resume_attempt`` carries only server-owned terminal results. The runtime never calls an
external provider while resolving them. Each result must still match a pending tool call from the
same run attempt before it can enter model context.
"""

from .pending_tools import take_pending_tool_calls
from ..protocol.candidates import candidate


def resolve_tool_results(
    coordinates: dict[str, object],
    tool_results: list[object],
    post_candidate,
) -> dict[str, object] | None:
    """Validate and consume exact saved tool results, or reject the whole batch."""
    # Keep validation output separate from registry state. Only after the complete wire batch has a
    # recognised terminal shape may this function consume the corresponding pending calls.
    validated: list[tuple[str, object]] = []
    tool_invocation_ids: list[str] = []
    # Validate every result before touching the pending-call registry. This keeps malformed commands
    # from partially consuming state that a byte-identical reconnect replay still needs.
    for entry in tool_results:
        if not isinstance(entry, dict) or not isinstance(entry.get("toolInvocationId"), str):
            post_candidate(candidate(coordinates, "run.error", {"reason": "invalid_tool_result"}))
            return None
        tool_invocation_id = entry["toolInvocationId"]
        outcome = entry.get("outcome")
        # Success requires an explicit result member, including when its value is null. Absence is not
        # silently converted into a provider result because the server owns the terminal receipt.
        if outcome == "succeeded" and "result" in entry:
            validated.append((tool_invocation_id, entry["result"]))
        else:
            failure_code = entry.get("failureCode")
            if outcome != "failed" or not isinstance(failure_code, str) or not failure_code:
                post_candidate(candidate(coordinates, "run.error", {"reason": "invalid_tool_result"}))
                return None
            # Feed only the stable failure code back to the model. Provider messages and execution
            # detail remain behind the control-plane boundary and cannot leak into model context.
            validated.append((tool_invocation_id, {"error": failure_code}))
        tool_invocation_ids.append(tool_invocation_id)

    # Pending-call identity is checked after structural validation and consumed atomically. This is
    # the replay fence that rejects duplicate, foreign-attempt, and never-proposed results.
    pending = take_pending_tool_calls(
        str(coordinates["runId"]),
        int(coordinates["attempt"]),
        tool_invocation_ids,
    )  # type: ignore[arg-type]
    if pending is None:
        post_candidate(candidate(coordinates, "run.error", {"reason": "unknown_tool_result"}))
        return None

    # The model adapter receives only invocation-to-result mappings. Stored tool names and arguments
    # are correlation evidence; replaying them here could be mistaken for authority to execute again.
    results: dict[str, object] = {}
    for tool_invocation_id, result in validated:
        results[tool_invocation_id] = result
    return results
