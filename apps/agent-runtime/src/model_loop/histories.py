"""Retain bounded framework message history for same-process deferred-tool resume.

This registry is subordinate scratch, never run authority. It holds opaque Pydantic message objects
only inside the non-restarting runtime Job and keys them by the server-admitted run attempt. A lost
process loses the history and must fail resume closed instead of reconstructing model context.
"""

import threading

_MAX_ACTIVE_HISTORIES = 256
_LOCK = threading.Lock()
_HISTORIES: dict[tuple[str, int], list[object]] = {}


def store_model_history(run_id: str, attempt: int, messages: list[object]) -> None:
    """Replace one attempt's opaque framework history within the bounded registry."""
    key = _key(run_id, attempt)
    with _LOCK:
        if key not in _HISTORIES and len(_HISTORIES) >= _MAX_ACTIVE_HISTORIES:
            raise RuntimeError("model-history registry is full")
        _HISTORIES[key] = list(messages)


def load_model_history(run_id: str, attempt: int) -> list[object] | None:
    """Return a copy of one exact attempt history, or none after restart/loss."""
    key = _key(run_id, attempt)
    with _LOCK:
        messages = _HISTORIES.get(key)
        return None if messages is None else list(messages)


def clear_model_history(run_id: str, attempt: int) -> None:
    """Drop subordinate history when the owning attempt terminates."""
    key = _key(run_id, attempt)
    with _LOCK:
        _HISTORIES.pop(key, None)


def _key(run_id: str, attempt: int) -> tuple[str, int]:
    """Reject malformed local coordinates before they enter shared process state."""
    if not isinstance(run_id, str) or not run_id or not isinstance(attempt, int) or attempt < 1:
        raise RuntimeError("model history requires exact run-attempt coordinates")
    return (run_id, attempt)
