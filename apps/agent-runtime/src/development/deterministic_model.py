"""Produce deterministic neutral model events for the Tier 2 simulated Agent profile.

This strategy runs after the normal bootstrap and command admission flow. It returns the same plain
event shapes as the Pydantic AI adapter, so attempt execution, message projection, resume
correlation, cancellation, and terminal candidates keep their existing owners.
It imports no model SDK, reads no attempt key, and performs no network or database access.
"""

import json
import threading
from collections.abc import Iterator

def _message_text(compiled_input: dict[str, object]) -> str:
    """Return the latest accepted text message, or an empty value when none exists."""
    messages = compiled_input.get("messages")
    if not isinstance(messages, list):
        return ""
    for message in reversed(messages):
        if isinstance(message, dict) and isinstance(message.get("content"), str):
            return message["content"]
    return ""


def _text_events(text: str) -> Iterator[dict[str, object]]:
    """Yield one text delta and fixed usage counters through the normal event projector."""
    yield {"type": "output_text", "text": text}
    yield {"type": "usage", "inputTokens": 0, "outputTokens": 0}


def deterministic_event_source(
    compiled_input: dict[str, object],
    cancel_event: threading.Event,
    steering_buffer: list[str],
) -> Iterator[dict[str, object]]:
    """Yield repeatable start events after normal command admission.

    Called by the development runtime's simulated start handler. Cancellation produces no events;
    otherwise the accepted message becomes a neutral text delta followed by zero usage counters.

    Args:
        compiled_input: Admitted run input whose latest text message is displayed.
        cancel_event: Attempt cancellation signal checked before producing output.
        steering_buffer: Unused start-time steering accepted for handler compatibility.

    Yields:
        Plain model events consumed by the existing attempt executor.
    """
    del steering_buffer
    if cancel_event.is_set():
        return
    message = _message_text(compiled_input)
    yield from _text_events(f"Simulated agent response: {message}".rstrip())


def deterministic_resume_event_source(
    compiled_input: dict[str, object],
    model_results: object,
    cancel_event: threading.Event,
    steering_buffer: list[str],
) -> Iterator[dict[str, object]]:
    """Yield a stable response to server-authorised resume results and steering.

    The caller has already matched and consumed pending result identities. This adapter serialises
    those accepted values for display; it never executes a tool or reconstructs a missing result.

    Args:
        compiled_input: Unused admitted input retained for handler compatibility.
        model_results: Server-authorised resume results already matched to pending requests.
        cancel_event: Attempt cancellation signal checked before producing output.
        steering_buffer: Accepted steering text appended to the deterministic response.

    Yields:
        Plain model events consumed by the existing resume executor.
    """
    del compiled_input
    if cancel_event.is_set():
        return
    result_text = json.dumps(model_results, sort_keys=True, separators=(",", ":"), default=str)
    steering_text = " | ".join(steering_buffer)
    suffix = f" Steering: {steering_text}" if steering_text else ""
    yield from _text_events(f"Simulated agent resumed with: {result_text}{suffix}")
