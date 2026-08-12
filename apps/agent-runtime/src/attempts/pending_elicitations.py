"""Retain process-local correlation for deferred participant-input tool calls.

The durable server request owns the public request id and lifecycle. This registry keeps only the
framework call id needed to return a terminal result into the same Pydantic run. Losing the process
loses this optimization and makes resume fail closed, just like the existing deferred-tool history.
"""

from .pending_result_lock import PENDING_RESULT_LOCK


_PENDING: dict[tuple[str, int, str], str] = {}
_MAX_PENDING_ELICITATIONS = 256


def record_pending_elicitation(run_id: str, attempt: int, request_key: str, framework_call_id: str) -> None:
    """Record one exact request-key-to-framework-call binding before candidate delivery."""
    coordinate = (run_id, attempt, request_key)
    with PENDING_RESULT_LOCK:
        existing = _PENDING.get(coordinate)
        if existing is not None and existing != framework_call_id:
            raise ValueError("elicitation request key is already bound")
        if existing is None and len(_PENDING) >= _MAX_PENDING_ELICITATIONS:
            raise ValueError("pending elicitation capacity exceeded")
        _PENDING[coordinate] = framework_call_id


def peek_pending_elicitations(run_id: str, attempt: int, request_keys: list[str]) -> list[str] | None:
    """Read exact framework call ids while the caller holds ``PENDING_RESULT_LOCK``."""
    coordinates = [(run_id, attempt, request_key) for request_key in request_keys]
    if len(set(coordinates)) != len(coordinates) or any(coordinate not in _PENDING for coordinate in coordinates):
        return None
    return [_PENDING[coordinate] for coordinate in coordinates]


def consume_pending_elicitations(run_id: str, attempt: int, request_keys: list[str]) -> None:
    """Consume a request batch already proved present while holding the shared lock."""
    for request_key in request_keys:
        del _PENDING[(run_id, attempt, request_key)]


def clear_pending_elicitations(run_id: str, attempt: int) -> None:
    """Drop subordinate correlation state when the attempt ends or is cancelled."""
    with PENDING_RESULT_LOCK:
        for coordinate in [key for key in _PENDING if key[:2] == (run_id, attempt)]:
            del _PENDING[coordinate]
