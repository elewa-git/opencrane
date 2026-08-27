"""Track proposed tool calls until the control plane returns saved terminal results.

An ``external_action`` candidate carries its execution arguments to the server-owned durable
authority. This bounded registry retains only the model-framework call identity needed to match a
saved result back into the same attempt. A resume consumes a complete batch exactly once.

This registry is deliberately not durable. A container restart can replay the Pod's public binding,
but it cannot reconstruct an in-flight framework call. A resume that cannot find its pending call
fails closed with a typed loop error rather than guessing.
"""

from .pending_result_lock import PENDING_RESULT_LOCK

# Upper bound on simultaneously pending proposed calls; a run beyond this is already pathological.
_MAX_PENDING_TOOL_CALLS = 256

# Looking up and removing are separate functions so that one caller can hold the shared lock across
# both this registry and the questions registry, and treat the pair as a single step. Do not rely on
# the GIL for that: it does not make a lookup and a delete one operation, and the stream and the worker
# can run on different threads.
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
    """Look up the calls a resume names, without removing them.

    The caller must already hold ``PENDING_RESULT_LOCK``, because it also checks the questions in the
    same resume and both lookups have to describe the same moment. Nothing is removed here, so a resume
    rejected for some other reason leaves this registry as it was and the server can send the same
    command again.

    Called by: ``resolve_resume_results`` in ``resume_results.py``.

    Returns:
        The matching entries, keyed by invocation id. ``None`` when an id is repeated, or when any id
        was not proposed by this attempt — in that case no id in the batch counts as found, and calls
        belonging to a different resume are left where they are.
    """
    keys = [(run_id, attempt, tool_invocation_id) for tool_invocation_id in tool_invocation_ids]
    if len(keys) != len(set(keys)) or any(key not in _PENDING for key in keys):
        return None
    return {key[2]: _PENDING[key] for key in keys}


def consume_pending_tool_calls(run_id: str, attempt: int, tool_invocation_ids: list[str]) -> None:
    """Remove calls that ``peek_pending_tool_calls`` has already found.

    Call this only after that lookup succeeded while holding the same lock, and never on its own. The
    deletes below assume every id is present.

    Removing the ids is what stops one result being used twice. Because the caller still holds the lock
    it took for the lookup, no second resume can slip in between the two steps.

    Called by: ``resolve_resume_results`` in ``resume_results.py``.

    Raises:
        KeyError: When an id is not in the registry, which means the caller skipped the lookup.
    """
    for tool_invocation_id in tool_invocation_ids:
        del _PENDING[(run_id, attempt, tool_invocation_id)]
