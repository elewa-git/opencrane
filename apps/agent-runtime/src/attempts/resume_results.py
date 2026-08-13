"""Turns one resume command's saved results into the mapping the model framework resumes from.

A resume can answer tool calls, participant questions, or both at once. The model framework keys every
call it is waiting on by its own call id, so both kinds end up in a single mapping. This module builds
that mapping, and it is the only place where the two pending registries are emptied.

Everything is checked before anything is removed. A command that is wrong in any part leaves both
registries untouched, so if the server sends the same command again it is handled the same way.
"""

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
    """Check both kinds of saved result, match them to what the model is waiting on, and take them.

    The model framework will not resume unless every call it is waiting on has a result. So this
    either produces the complete set or produces nothing: a half-applied resume would leave the
    framework with an unanswered call and break the run.

    Called by: ``execute_resume_attempt`` in ``execution.py``.

    Returns:
        A mapping from model call id to result, ready to hand to the framework. ``None`` when the
        command cannot be used, in which case nothing has been removed from either registry and the
        caller should fail the attempt.
    """
    # 1. Check the shape of both batches first. Neither call touches the registries, so a malformed
    #    command is rejected before anything becomes impossible to replay.
    validated_tools = validate_tool_results(tool_results)
    validated_elicitations = resolve_elicitation_results(elicitation_results)
    if validated_tools is None or validated_elicitations is None:
        return None
    tool_ids, tool_values = validated_tools
    request_keys = [str(result["requestKey"]) for result in validated_elicitations]
    run_id = str(coordinates["runId"])
    attempt = int(coordinates["attempt"])
    # 2. Hold one lock across both lookups and both removals. Taking a lock per registry would let a
    #    second resume see the tool calls already taken while the questions were still waiting.
    with PENDING_RESULT_LOCK:
        pending_tools = peek_pending_tool_calls(run_id, attempt, tool_ids)
        elicitation_call_ids = peek_pending_elicitations(run_id, attempt, request_keys)
        # 3. If either lookup fails, reject the whole resume. Applying one half would resume the model
        #    with calls still unanswered.
        if pending_tools is None or elicitation_call_ids is None:
            return None
        # 4. Refuse if a tool invocation id is also a question's model call id. Both go into one
        #    mapping, so an overlap would let one result quietly replace the other.
        if set(tool_ids).intersection(elicitation_call_ids):
            return None
        # 5. Pair each answer with the call waiting for it. Both lists came from the same batch in the
        #    same order; ``strict`` turns any future drift between them into an error here instead of
        #    an answer delivered to the wrong call.
        resolved_elicitations = {
            call_id: result
            for call_id, result in zip(elicitation_call_ids, validated_elicitations, strict=True)
        }
        # 6. Remove both sets now that every check has passed, still under the same lock. Each result
        #    reaches the model once, and a duplicate command later finds nothing waiting.
        consume_pending_tool_calls(run_id, attempt, tool_ids)
        consume_pending_elicitations(run_id, attempt, request_keys)
    return {**tool_values, **resolved_elicitations}
