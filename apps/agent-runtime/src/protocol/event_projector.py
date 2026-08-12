"""Project one command's neutral stream into ordered canonical candidates.

The projector owns ephemeral message lifecycle state and tool proposal ordering. It does not own
durable acceptance: every candidate still crosses the server's fenced persistence authority.
"""

import hashlib
from collections.abc import Callable

from .candidates import candidate, elicitation_candidate, normalize_event, tool_call_candidate
from .elicitation import elicitation_proposal
from ..attempts.pending_elicitations import record_pending_elicitation


class RuntimeEventProjector:
    """Projects one accepted command's neutral events into canonical candidates, keeping state across them."""

    def __init__(
        self,
        coordinates: dict[str, object],
        compiled_input: dict[str, object],
        post_candidate: Callable[[dict[str, object]], None],
        record_tool_call: Callable[[str, int, str, str, object], None],
        publish_output: Callable[[dict[str, object], str, dict[str, object]], None] | None = None,
    ) -> None:
        """Bind projection to immutable command coordinates and its frozen grant set."""
        # This object is intentionally command-scoped. Reusing it across commands would carry message
        # lifecycle or pending-tool state across fences and corrupt event ordering.
        self._coordinates = coordinates
        self._compiled_input = compiled_input
        self._post_candidate = post_candidate
        self._record_tool_call = record_tool_call
        self._publish_output = publish_output
        # Deriving the message id from the command makes replay deterministic while keeping separate
        # command lifecycles distinct inside the same run attempt.
        self._message_id = f"assistant:{coordinates['commandId']}"
        self._message_started = False
        self._has_pending_tool_calls = False
        self._has_pending_elicitations = False

    @property
    def has_pending_tool_calls(self) -> bool:
        """Whether this command proposed at least one durable external action."""
        return self._has_pending_tool_calls

    @property
    def has_pending_input(self) -> bool:
        """Whether this command proposed a tool action or participant input and must pause."""
        return self._has_pending_tool_calls or self._has_pending_elicitations

    @property
    def has_pending_elicitations(self) -> bool:
        """Whether the model asked its one participant-input question for this command."""
        return self._has_pending_elicitations

    def emit(self, neutral_event: dict[str, object]) -> None:
        """Emit the canonical candidate sequence for one neutral model event."""
        # Tool calls have a multi-candidate lifecycle and must bypass the ordinary one-event mapping.
        if neutral_event.get("type") == "tool_call":
            self._emit_tool_call(neutral_event)
            return
        if neutral_event.get("type") == "output_asset":
            self._emit_output_asset(neutral_event)
            return
        if neutral_event.get("type") == "elicitation_request":
            self._emit_elicitation(neutral_event)
            return
        if neutral_event.get("type") == "invalid_elicitation_request":
            raise ValueError("invalid elicitation request")
        normalized = normalize_event(neutral_event, self._message_id)
        if normalized is None:
            return
        # The first text delta opens the message before that delta is emitted. The flag is flipped
        # only after the start candidate is posted, so a failed post cannot advance local lifecycle
        # state beyond what may have reached server authority.
        if normalized[0] == "message.delta":
            self._start_message()
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

    def _emit_elicitation(self, neutral_event: dict[str, object]) -> None:
        """Emit one strictly bounded request and pause this local command after delivery."""
        if self._has_pending_elicitations:
            raise ValueError("multiple elicitation requests in one command")
        proposal = elicitation_proposal(neutral_event)
        if proposal is None:
            # Failing the command is safer than pretending a malformed model request did not need an
            # answer. The executor reports only the exception class, never model-authored fields.
            raise ValueError("invalid elicitation request")
        framework_call_id = neutral_event.get("frameworkCallId")
        if not isinstance(framework_call_id, str) or not framework_call_id:
            raise ValueError("missing elicitation framework call")
        # Any assistant text explaining the question must become a complete message before the
        # participant-facing card. The executor stops reading immediately after this candidate.
        self.complete_message()
        record_pending_elicitation(
            str(self._coordinates["runId"]),
            int(self._coordinates["attempt"]),
            str(proposal["requestKey"]),
            framework_call_id,
        )  # type: ignore[arg-type]
        self._post_candidate(elicitation_candidate(self._coordinates, proposal))
        self._has_pending_elicitations = True

    def _start_message(self) -> None:
        """Persist the assistant message start once before text or generated outputs."""
        if self._message_started:
            return
        self._post_candidate(
            candidate(
                self._coordinates,
                "message.started",
                {"messageId": self._message_id, "role": "assistant"},
            ),
        )
        self._message_started = True

    def _emit_output_asset(self, neutral_event: dict[str, object]) -> None:
        """Bind one local generated output to the already-saved assistant message."""
        if self._publish_output is None:
            raise RuntimeError("generated output transport is unavailable")
        content = neutral_event.get("content")
        output_ordinal = neutral_event.get("outputOrdinal")
        if not isinstance(content, bytes) or not isinstance(output_ordinal, int) or output_ordinal < 0:
            raise ValueError("generated output identity is invalid")
        content_digest = hashlib.sha256(content).hexdigest()
        identity = f"{self._message_id}\0{output_ordinal}\0{content_digest}".encode()
        output = {
            **neutral_event,
            "idempotencyKey": f"model-file:{hashlib.sha256(identity).hexdigest()}",
        }
        self._start_message()
        self._publish_output(self._coordinates, self._message_id, output)
