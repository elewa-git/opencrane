"""Remembers which model tool call asked each pending question.

When the model asks the participant something, two identities exist for the same question. The server
creates a database row and owns the request id and its lifecycle. The model framework knows the
question only by the tool call id it generated. This registry stores the link between them, so that
when the answer comes back the runtime can hand it to the call that is waiting for it.

Nothing here is written to a database, and that is deliberate. The runtime Job never restarts
(``backoffLimit: 0``), so if the process dies the stream fence dies with it and the server ends the
attempt anyway. A resume that cannot find its question therefore refuses to continue rather than
guessing which call the answer belongs to.
"""

from .pending_result_lock import PENDING_RESULT_LOCK


# The key is the request key the model chose, plus the run and attempt it was asked in, so the same
# key used again in a different attempt cannot collide with this one. The value is just the framework
# call id. No question text, no answer, and no participant identity is kept in this process.
_PENDING: dict[tuple[str, int, str], str] = {}
# How many questions may wait at once in one process. A run that passes this is already broken.
_MAX_PENDING_ELICITATIONS = 256


def record_pending_elicitation(run_id: str, attempt: int, request_key: str, framework_call_id: str) -> None:
    """Link one request key to the model tool call that asked it.

    Call this before sending the question to the server, so a question the participant can see always
    has a route back to the model. Raising here fails the whole command, which is the outcome you
    want: no card has been sent yet, so nothing is left waiting for an answer that could never be
    delivered.

    Called by: ``RuntimeEventProjector._emit_elicitation`` in ``protocol/event_projector.py``.

    Raises:
        ValueError: When this request key is already linked to a different tool call, or when the
            process already holds ``_MAX_PENDING_ELICITATIONS`` questions.
    """
    coordinate = (run_id, attempt, request_key)
    with PENDING_RESULT_LOCK:
        existing = _PENDING.get(coordinate)
        # 1. Recording the same key against the same call twice is harmless, so allow it. Recording it
        #    against a different call is not: one of the two model calls would get the other's answer.
        if existing is not None and existing != framework_call_id:
            raise ValueError("elicitation request key is already bound")
        # 2. Check the ceiling under the same lock that inserts, so two questions arriving together
        #    cannot both find room and push past it. Replacing an existing key adds no entry, so that
        #    case is allowed even when the registry is full.
        if existing is None and len(_PENDING) >= _MAX_PENDING_ELICITATIONS:
            raise ValueError("pending elicitation capacity exceeded")
        # 3. Store the link. From here a resume naming this request key can find its model call.
        _PENDING[coordinate] = framework_call_id


def peek_pending_elicitations(run_id: str, attempt: int, request_keys: list[str]) -> list[str] | None:
    """Look up the model call ids for a set of request keys, without removing them.

    The caller must already hold ``PENDING_RESULT_LOCK``, because it also checks the tool-call
    registry and both lookups have to describe the same moment. Nothing is removed here, so a resume
    that is rejected for some other reason leaves this registry as it was and the server can send the
    same command again.

    Called by: ``resolve_resume_results`` in ``resume_results.py``.

    Returns:
        The matching call ids, in the same order as ``request_keys``, so the caller can pair each
        answer with the call waiting for it. ``None`` when a key is repeated, or when any key was not
        asked in this attempt — in that case no key in the batch counts as found.
    """
    coordinates = [(run_id, attempt, request_key) for request_key in request_keys]
    # Accept the batch only if every key checks out. A repeated key does not say which answer wins,
    # and a key this attempt never asked about means the answer belongs to something else entirely.
    if len(set(coordinates)) != len(coordinates) or any(coordinate not in _PENDING for coordinate in coordinates):
        return None
    return [_PENDING[coordinate] for coordinate in coordinates]


def consume_pending_elicitations(run_id: str, attempt: int, request_keys: list[str]) -> None:
    """Remove questions that ``peek_pending_elicitations`` has already found.

    Call this only after that lookup succeeded while holding the same lock, and never on its own. The
    deletes below assume every key is present.

    Removing the keys is what stops one answer being used twice. Because the caller still holds the
    lock it took for the lookup, no second resume can slip in between the two steps.

    Called by: ``resolve_resume_results`` in ``resume_results.py``.

    Raises:
        KeyError: When a key is not in the registry, which means the caller skipped the lookup.
    """
    for request_key in request_keys:
        del _PENDING[(run_id, attempt, request_key)]


def clear_pending_elicitations(run_id: str, attempt: int) -> None:
    """Forget every pending question for an attempt that has finished.

    Called on each way an attempt can end: it completed, it was cancelled, or it failed. Once it has
    ended no resume for it will arrive, so a question still recorded here is memory nobody will read.
    The server has already closed the matching database rows. Questions belonging to other attempts
    are left alone.

    Called by: ``execute_start_attempt``, ``execute_resume_attempt``, and ``execute_cancel_attempt``
    in ``execution.py``.
    """
    with PENDING_RESULT_LOCK:
        # Collect the keys into a list first. Deleting from the dictionary while looping over it raises
        # RuntimeError.
        for coordinate in [key for key in _PENDING if key[:2] == (run_id, attempt)]:
            del _PENDING[coordinate]
