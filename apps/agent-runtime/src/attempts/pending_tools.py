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

# Looking up and removing are separate so one caller can hold the shared lock across this registry and
# the questions registry and treat the pair as one step. The GIL does not make a lookup and a delete one
# operation, and the stream and the worker run on different threads.
# Keys include run and attempt so a provider-chosen call id cannot alias a call from another attempt.
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
        # Checked under the insert's own lock, so two proposals cannot both find room.
        if len(_PENDING) >= _MAX_PENDING_TOOL_CALLS:
            return
        _PENDING[(run_id, attempt, tool_invocation_id)] = {"toolName": tool_name, "arguments": arguments}


def peek_pending_tool_calls(run_id: str, attempt: int, tool_invocation_ids: list[str]) -> dict[str, dict[str, object]] | None:
    """Look up the calls a resume names, without removing them.

    The caller must already hold ``PENDING_RESULT_LOCK``: it checks the questions registry in the same
    resume, and both lookups have to describe the same moment. Removing nothing here is what lets a
    resume rejected for some other reason be sent again.

    Returns:
        The matching entries, keyed by invocation id. ``None`` if an id repeats or was not proposed by
        this attempt, in which case none of the batch counts as found.
    """
    keys = [(run_id, attempt, tool_invocation_id) for tool_invocation_id in tool_invocation_ids]
    if len(keys) != len(set(keys)) or any(key not in _PENDING for key in keys):
        return None
    return {key[2]: _PENDING[key] for key in keys}


def consume_pending_tool_calls(run_id: str, attempt: int, tool_invocation_ids: list[str]) -> None:
    """Remove calls that ``peek_pending_tool_calls`` has already found.

    Call this only after that lookup succeeded under the same held lock — the deletes assume every id is
    present. Removing them under that lock is what stops one result being used twice.

    Raises:
        KeyError: When an id is missing, which means the caller skipped the lookup.
    """
    for tool_invocation_id in tool_invocation_ids:
        del _PENDING[(run_id, attempt, tool_invocation_id)]
