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
    """Yield one repeatable text response and usage event without a model request."""
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
    """
    del compiled_input
    if cancel_event.is_set():
        return
    result_text = json.dumps(model_results, sort_keys=True, separators=(",", ":"), default=str)
    steering_text = " | ".join(steering_buffer)
    suffix = f" Steering: {steering_text}" if steering_text else ""
    yield from _text_events(f"Simulated agent resumed with: {result_text}{suffix}")
