"""Project one command's neutral stream into ordered canonical candidates.

The projector owns ephemeral message lifecycle state and tool proposal ordering. It does not own
durable acceptance: every candidate still crosses the server's fenced persistence authority.
"""

from collections.abc import Callable

from .candidates import candidate, normalize_event, tool_call_candidate


class RuntimeEventProjector:
    """Stateful neutral-to-canonical projection for exactly one accepted command."""

    def __init__(
        self,
        coordinates: dict[str, object],
        compiled_input: dict[str, object],
        post_candidate: Callable[[dict[str, object]], None],
        record_tool_call: Callable[[str, int, str, str, object], None],
    ) -> None:
        """Bind projection to immutable command coordinates and its frozen grant set."""
        self._coordinates = coordinates
        self._compiled_input = compiled_input
        self._post_candidate = post_candidate
        self._record_tool_call = record_tool_call
        self._message_id = f"assistant:{coordinates['commandId']}"
        self._message_started = False
        self._has_pending_tool_calls = False

    @property
    def has_pending_tool_calls(self) -> bool:
        """Whether this command proposed at least one durable external action."""
        return self._has_pending_tool_calls

    def emit(self, neutral_event: dict[str, object]) -> None:
        """Emit the canonical candidate sequence for one neutral model event."""
        if neutral_event.get("type") == "tool_call":
            self._emit_tool_call(neutral_event)
            return
        normalized = normalize_event(neutral_event, self._message_id)
        if normalized is None:
            return
        if normalized[0] == "message.delta" and not self._message_started:
            self._post_candidate(
                candidate(
                    self._coordinates,
                    "message.started",
                    {"messageId": self._message_id, "role": "assistant"},
                ),
            )
            self._message_started = True
        self._post_candidate(candidate(self._coordinates, normalized[0], normalized[1]))

    def complete_message(self) -> None:
        """Close a started message once, while leaving an interrupted partial stream open."""
        if not self._message_started:
            return
        self._post_candidate(
            candidate(
                self._coordinates,
                "message.completed",
                {"messageId": self._message_id},
            ),
        )
        self._message_started = False

    def _emit_tool_call(self, neutral_event: dict[str, object]) -> None:
        """Emit a request and retain only the identity needed to match its saved result."""
        proposal = tool_call_candidate(
            self._coordinates,
            self._compiled_input,
            neutral_event,
        )
        if proposal.get("kind") == "external_action":
            self._has_pending_tool_calls = True
            self._post_candidate(
                candidate(
                    self._coordinates,
                    "tool.requested",
                    {
                        "toolCallId": proposal["toolInvocationId"],
                        "toolCallName": neutral_event.get("toolName"),
                    },
                ),
            )
            self._record_tool_call(
                str(self._coordinates["runId"]),
                int(self._coordinates["attempt"]),  # type: ignore[arg-type]
                str(proposal["toolInvocationId"]),
                str(neutral_event.get("toolName")),
                proposal["arguments"],
            )
        self._post_candidate(proposal)
