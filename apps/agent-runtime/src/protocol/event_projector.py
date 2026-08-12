"""Project one command's neutral stream into ordered canonical candidates.

The projector owns ephemeral message lifecycle state and tool proposal ordering. It does not own
durable acceptance: every candidate still crosses the server's fenced persistence authority.
"""

from collections.abc import Callable

from .candidates import candidate, normalize_event, tool_call_candidate


class RuntimeEventProjector:
    """Projects one accepted command's neutral events into canonical candidates, keeping state across them."""

    def __init__(
        self,
        coordinates: dict[str, object],
        compiled_input: dict[str, object],
        post_candidate: Callable[[dict[str, object]], None],
        record_tool_call: Callable[[str, int, str, str, object], None],
    ) -> None:
        """Bind projection to immutable command coordinates and its frozen grant set."""
        # This object is intentionally command-scoped. Reusing it across commands would carry message
        # lifecycle or pending-tool state across fences and corrupt event ordering.
        self._coordinates = coordinates
        self._compiled_input = compiled_input
        self._post_candidate = post_candidate
        self._record_tool_call = record_tool_call
        # Deriving the message id from the command makes replay deterministic while keeping separate
        # command lifecycles distinct inside the same run attempt.
        self._message_id = f"assistant:{coordinates['commandId']}"
        self._message_started = False
        self._has_pending_tool_calls = False

    @property
    def has_pending_tool_calls(self) -> bool:
        """Whether this command proposed at least one durable external action."""
        return self._has_pending_tool_calls

    def emit(self, neutral_event: dict[str, object]) -> None:
        """Emit the canonical candidate sequence for one neutral model event."""
        # Tool calls have a multi-candidate lifecycle and must bypass the ordinary one-event mapping.
        if neutral_event.get("type") == "tool_call":
            self._emit_tool_call(neutral_event)
            return
        normalized = normalize_event(neutral_event, self._message_id)
        if normalized is None:
            return
        # The first text delta opens the message before that delta is emitted. The flag is flipped
        # only after the start candidate is posted, so a failed post cannot advance local lifecycle
        # state beyond what may have reached server authority.
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
        """Close a started message once; if its stream was interrupted part-way, leave it open."""
        # No synthetic empty message is created when the model produces only usage, errors, or tools.
        if not self._message_started:
            return
        self._post_candidate(
            candidate(
                self._coordinates,
                "message.completed",
                {"messageId": self._message_id},
            ),
        )
        # Reset only after delivery succeeds. An ambiguous transport failure is handled at the stable
        # candidate boundary rather than pretending the local lifecycle definitely completed.
        self._message_started = False

    def _emit_tool_call(self, neutral_event: dict[str, object]) -> None:
        """Emit the request and keep only the id needed to match its saved result later."""
        proposal = tool_call_candidate(
            self._coordinates,
            self._compiled_input,
            neutral_event,
        )
        if proposal.get("kind") == "external_action":
            # ``tool.requested`` is ordered before the external-action proposal so the durable event
            # history explains why authorization/execution was requested.
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
            # Record the exact pending-call identity before posting the actionable proposal. A resume
            # result is accepted only when it maps back to this run/attempt/invocation tuple.
            self._record_tool_call(
                str(self._coordinates["runId"]),
                int(self._coordinates["attempt"]),  # type: ignore[arg-type]
                str(proposal["toolInvocationId"]),
                str(neutral_event.get("toolName")),
                proposal["arguments"],
            )
        # Failed projections still emit their bounded error proposal, while valid proposals are sent
        # only after their explanatory event and resume correlation state have been established.
        self._post_candidate(proposal)
