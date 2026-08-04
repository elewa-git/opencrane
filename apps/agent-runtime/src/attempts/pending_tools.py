"""Track proposed tool calls until the control plane's approval decision returns.

An ``external_action`` candidate carries only identifiers and digests to the server; the concrete
tool name and parsed arguments needed to EXECUTE the call after approval stay here, in bounded
process-local attempt state. A resume maps each authorized ``toolInvocationId`` back to its pending
call exactly once — taking an entry removes it, so a duplicated resume cannot re-execute a call.

This registry is deliberately not durable: the runtime Job never restarts (``backoffLimit: 0``), so
a lost process also loses its stream fence and the attempt terminates server-side. A resume that
cannot find its pending call fails closed with a typed loop error rather than guessing.
"""

import threading

# Upper bound on simultaneously pending proposed calls; a run beyond this is already pathological.
_MAX_PENDING_TOOL_CALLS = 256

_LOCK = threading.Lock()
_PENDING: dict[tuple[str, int, str], dict[str, object]] = {}


def record_pending_tool_call(
    run_id: str,
    attempt: int,
    tool_invocation_id: str,
    tool_name: str,
    arguments: object,
) -> None:
    """Remember one proposed tool call so an approved resume can execute it.

    Beyond the bounded ceiling new entries are dropped: the later resume then fails closed for that
    invocation instead of this registry growing without limit.
    """
    with _LOCK:
        if len(_PENDING) >= _MAX_PENDING_TOOL_CALLS:
            return
        _PENDING[(run_id, attempt, tool_invocation_id)] = {"toolName": tool_name, "arguments": arguments}


def take_pending_tool_call(run_id: str, attempt: int, tool_invocation_id: str) -> dict[str, object] | None:
    """Return and remove the pending call for one authorized invocation, or ``None`` when unknown."""
    with _LOCK:
        return _PENDING.pop((run_id, attempt, tool_invocation_id), None)
