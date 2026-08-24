"""Produce deterministic neutral model events for the Tier 2 simulated Agent profile.

This strategy runs after the normal bootstrap and command admission flow. It returns the same plain
event shapes as the Pydantic AI adapter, so attempt execution, message projection, external-action
admission, resume correlation, cancellation, and terminal candidates keep their existing owners.
It imports no model SDK, reads no attempt key, and performs no network or database access.
"""

import json
import re
import threading
from collections.abc import Iterator

# Developers may use this explicit message form to exercise the real external-action and resume
# pipeline without allowing ordinary chat text to select tools by accident.
_TOOL_DIRECTIVE = re.compile(r"^/simulate-tool\s+([A-Za-z0-9_-]{1,64})\s+(\{.*\})$", re.DOTALL)


def _message_text(compiled_input: dict[str, object]) -> str:
    """Return the latest accepted text message, or an empty value when none exists."""
    messages = compiled_input.get("messages")
    if not isinstance(messages, list):
        return ""
    for message in reversed(messages):
        if isinstance(message, dict) and isinstance(message.get("content"), str):
            return message["content"]
    return ""


def _tool_names(compiled_input: dict[str, object]) -> set[str]:
    """Return model-visible tool names from the control-plane-compiled grant set."""
    tools = compiled_input.get("tools")
    if not isinstance(tools, list):
        return set()
    return {
        str(tool["name"])
        for tool in tools
        if isinstance(tool, dict) and isinstance(tool.get("name"), str)
    }


def _text_events(text: str) -> Iterator[dict[str, object]]:
    """Yield one text delta and fixed usage counters through the normal event projector."""
    yield {"type": "output_text", "text": text}
    yield {"type": "usage", "inputTokens": 0, "outputTokens": 0}


def deterministic_event_source(
    compiled_input: dict[str, object],
    cancel_event: threading.Event,
    steering_buffer: list[str],
) -> Iterator[dict[str, object]]:
    """Yield repeatable start events without a model request.

    Normal messages receive a stable simulated response. The explicit ``/simulate-tool`` developer
    directive proposes one tool from the compiled grant set, allowing the same durable external
    action and later resume path to be tested. Unknown tools and malformed JSON fail the attempt
    instead of inventing broader authority.
    """
    del steering_buffer
    if cancel_event.is_set():
        return
    message = _message_text(compiled_input)
    directive = _TOOL_DIRECTIVE.fullmatch(message.strip())
    if directive is None:
        yield from _text_events(f"Simulated agent response: {message}".rstrip())
        return
    tool_name = directive.group(1)
    if tool_name not in _tool_names(compiled_input):
        raise ValueError("simulated tool is not present in the compiled grant set")
    arguments = json.loads(directive.group(2))
    if not isinstance(arguments, dict):
        raise ValueError("simulated tool arguments must be a JSON object")
    yield {
        "type": "tool_call",
        "toolName": tool_name,
        "toolCallId": "simulated-tool-call-1",
        "arguments": json.dumps(arguments, sort_keys=True, separators=(",", ":")),
    }
    yield {"type": "usage", "inputTokens": 0, "outputTokens": 0}


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
