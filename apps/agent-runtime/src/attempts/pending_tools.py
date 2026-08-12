"""Track proposed tool calls until the control plane returns saved terminal results.

An ``external_action`` candidate carries its execution arguments to the server-owned durable
authority. This bounded registry retains only the model-framework call identity needed to match a
saved result back into the same attempt. A resume consumes a complete batch exactly once.

This registry is deliberately not durable: the runtime Job never restarts (``backoffLimit: 0``), so
a lost process also loses its stream fence and the attempt terminates server-side. A resume that
cannot find its pending call fails closed with a typed loop error rather than guessing.
"""

from .pending_result_lock import PENDING_RESULT_LOCK

# Upper bound on simultaneously pending proposed calls; a run beyond this is already pathological.
_MAX_PENDING_TOOL_CALLS = 256

# The lock protects validation and consumption as one operation. The GIL is not an authority or an
# atomicity contract, and stream dispatch may overlap worker completion on different threads.
# Keys include run and attempt so a provider-chosen call id cannot alias a call from another fenced
# execution. Stored values are model-loop correlation data, never approval or execution receipts.
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
    with PENDING_RESULT_LOCK:
        # Capacity is checked while holding the same lock as insertion. Concurrent proposals cannot
        # both observe free capacity and push the process registry past its defensive ceiling.
        if len(_PENDING) >= _MAX_PENDING_TOOL_CALLS:
            return
        # Below the ceiling, re-recording the same composite identity replaces only ephemeral
        # correlation data. Durable idempotency and action execution remain control-plane concerns.
        _PENDING[(run_id, attempt, tool_invocation_id)] = {"toolName": tool_name, "arguments": arguments}


def peek_pending_tool_calls(run_id: str, attempt: int, tool_invocation_ids: list[str]) -> dict[str, dict[str, object]] | None:
    """Read a complete correlation batch while the caller holds ``PENDING_RESULT_LOCK``."""
    keys = [(run_id, attempt, tool_invocation_id) for tool_invocation_id in tool_invocation_ids]
    if len(keys) != len(set(keys)) or any(key not in _PENDING for key in keys):
        return None
    return {key[2]: _PENDING[key] for key in keys}


def consume_pending_tool_calls(run_id: str, attempt: int, tool_invocation_ids: list[str]) -> None:
    """Consume a batch already proved present while the caller holds the shared lock."""
    for tool_invocation_id in tool_invocation_ids:
        del _PENDING[(run_id, attempt, tool_invocation_id)]
