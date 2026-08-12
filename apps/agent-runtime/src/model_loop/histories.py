"""Keeps each attempt's model conversation in memory between a pause and its resume.

When the model asks for a tool or a question, the turn ends and the runtime waits for the server to
come back with a result. To carry on from there, the model framework needs the messages of the turn it
already produced. This registry holds them, keyed by run and attempt.

It is memory only, never a database, and it belongs to the process that made it. If that process is
replaced the messages are gone, and a resume that finds nothing here refuses to continue rather than
rebuilding the conversation from the compiled input — which would drop the very turn that asked.
"""

import threading

# How many attempts may hold messages at once in one process. Passing this raises instead of dropping
# the oldest entry, because a silent drop would surface much later as a resume that cannot explain why
# its messages disappeared.
_MAX_ACTIVE_HISTORIES = 256
# Storing, loading, and clearing can happen on different threads while the stream and the worker
# overlap, so every read and write of the mapping below holds this lock.
_LOCK = threading.Lock()
# Keyed by run and attempt so a retried attempt cannot pick up the previous attempt's conversation. The
# values are the framework's own message objects; nothing here looks inside them.
_HISTORIES: dict[tuple[str, int], list[object]] = {}


def store_model_history(run_id: str, attempt: int, messages: list[object]) -> None:
    """Save the messages of the turn that just finished, replacing anything held for this attempt.

    Called after a turn closes and only when the attempt was not cancelled, so a cancelled turn leaves
    nothing behind for a resume that should no longer happen. A resume overwrites what the first turn
    stored, because the next resume has to continue from the latest turn rather than an earlier one.

    Called by: ``pydantic_ai_event_source`` and ``pydantic_ai_resume_source`` in ``driver.py``.

    Raises:
        RuntimeError: When the coordinates are malformed, or when this is a new attempt and the process
            already holds ``_MAX_ACTIVE_HISTORIES`` conversations.
    """
    key = _key(run_id, attempt)
    with _LOCK:
        # Only a new attempt can be turned away when full. Replacing an existing entry adds nothing,
        # and refusing that would strand an attempt that is already part-way through.
        if key not in _HISTORIES and len(_HISTORIES) >= _MAX_ACTIVE_HISTORIES:
            raise RuntimeError("model-history registry is full")
        # Copy the list, so that if the adapter later changes its own list the stored messages stay as
        # they were when the turn ended.
        _HISTORIES[key] = list(messages)


def load_model_history(run_id: str, attempt: int) -> list[object] | None:
    """Read back the messages stored for one attempt.

    Called by: ``pydantic_ai_resume_source`` in ``driver.py``.

    Returns:
        A copy of the messages, or ``None`` when this process holds none for the attempt — which
        happens when the process was replaced. The caller must treat ``None`` as a reason to stop:
        rebuilding the conversation from the compiled input would lose the turn that asked for the
        tool or the question, and the model would receive an answer to something it never asked.

    Raises:
        RuntimeError: When the coordinates are malformed.
    """
    key = _key(run_id, attempt)
    with _LOCK:
        messages = _HISTORIES.get(key)
        # Hand back a copy. The caller passes this to the framework, which appends to it as the resumed
        # turn runs.
        return None if messages is None else list(messages)


def clear_model_history(run_id: str, attempt: int) -> None:
    """Forget the messages held for an attempt that has finished.

    Called on each way an attempt can end, including cancellation and failure, so that a finished
    attempt keeps no conversation in memory. Holding none for the attempt is normal: it can end before
    any turn stored messages.

    Called by: ``execute_start_attempt``, ``execute_resume_attempt``, and ``execute_cancel_attempt``
    in ``execution.py``.

    Raises:
        RuntimeError: When the coordinates are malformed.
    """
    key = _key(run_id, attempt)
    with _LOCK:
        _HISTORIES.pop(key, None)


def _key(run_id: str, attempt: int) -> tuple[str, int]:
    """Build the registry key, refusing coordinates that would point at the wrong attempt.

    Raising is deliberate. An empty run id or an attempt below one produces a key that either collides
    with another attempt's messages or hides them.
    """
    if not isinstance(run_id, str) or not run_id or not isinstance(attempt, int) or attempt < 1:
        raise RuntimeError("model history requires exact run-attempt coordinates")
    return (run_id, attempt)
