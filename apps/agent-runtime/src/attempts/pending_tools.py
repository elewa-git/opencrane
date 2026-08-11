"""Track proposed tool calls until the control plane returns saved terminal results.

An ``external_action`` candidate carries its execution arguments to the server-owned durable
authority. This bounded registry retains only the model-framework call identity needed to match a
saved result back into the same attempt. A resume consumes a complete batch exactly once.

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
    """Remember one proposed tool call so a saved terminal result can resolve it.

    Beyond the bounded ceiling new entries are dropped: the later resume then fails closed for that
    invocation instead of this registry growing without limit.
    """
    with _LOCK:
        if len(_PENDING) >= _MAX_PENDING_TOOL_CALLS:
            return
        _PENDING[(run_id, attempt, tool_invocation_id)] = {"toolName": tool_name, "arguments": arguments}


def take_pending_tool_calls(
    run_id: str,
    attempt: int,
    tool_invocation_ids: list[str],
) -> dict[str, dict[str, object]] | None:
    """Atomically validate and consume one complete saved-result batch.

    No entry is removed when an id is duplicated or unknown, so a malformed server command cannot
    partially consume state and make a later byte-identical redelivery impossible to validate.
    """
    with _LOCK:
        keys = [(run_id, attempt, tool_invocation_id) for tool_invocation_id in tool_invocation_ids]
        if len(keys) != len(set(keys)) or any(key not in _PENDING for key in keys):
            return None
        pending = {key[2]: _PENDING[key] for key in keys}
        for key in keys:
            del _PENDING[key]
        return pending
