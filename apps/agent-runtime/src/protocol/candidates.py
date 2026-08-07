"""Project neutral model events into bounded OpenCrane protocol candidates.

This is the language-neutral seam between the Pydantic adapter and control-plane authority. Every
candidate is bound to the accepted runtime instance, command, run, attempt, and fence. Tool revisions
come only from the compiled grant set; model output can propose arguments but cannot select its own
authority.
"""

import hashlib
import json
import uuid

from ..constants import PROTOCOL_VERSION
from ..observability import log


def command_coordinates(
    command: dict[str, object],
    runtime_instance_id: str,
) -> dict[str, object] | None:
    """Extract the immutable authority coordinates every candidate must echo.

    Returning ``None`` is fail-closed: an incomplete command cannot produce even an error candidate,
    because the control plane would have no trustworthy coordinates to attach that error to.
    """
    assignment = command.get("assignment")
    command_id = command.get("commandId")
    fence = command.get("fence")
    if not isinstance(assignment, dict) or not isinstance(command_id, str) or not isinstance(fence, int):
        return None
    run_id = assignment.get("runId")
    attempt = assignment.get("attempt")
    if not isinstance(run_id, str) or not isinstance(attempt, int):
        return None
    return {
        "protocolVersion": PROTOCOL_VERSION,
        "runtimeInstanceId": runtime_instance_id,
        "commandId": command_id,
        "runId": run_id,
        "attempt": attempt,
        "fence": fence,
    }


def candidate(
    coordinates: dict[str, object],
    event_type: str,
    payload: dict[str, object],
) -> dict[str, object]:
    """Build one event candidate with a fresh replay identity.

    Candidate delivery may retry this exact dictionary, but callers must never call this constructor
    again for the retry. Reusing the original ``candidateId`` is what lets the control plane treat a
    lost response as idempotent replay rather than a second event.
    """
    return {
        **coordinates,
        "candidateId": str(uuid.uuid4()),
        "kind": "event",
        "eventType": event_type,
        "payload": payload,
    }


def arguments_digest(arguments: object) -> str:
    """Compute the deterministic argument digest independently re-derived by the control plane.

    Sorted keys and compact separators remove presentation differences from JSON objects. The
    ``sha256:`` prefix makes the digest algorithm explicit in the wire value.
    """
    canonical = json.dumps(arguments, sort_keys=True, separators=(",", ":"))
    return "sha256:" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def external_action_candidate(
    coordinates: dict[str, object],
    tool_revision_id: str,
    tool_invocation_id: str,
    digest: str,
    arguments: object,
) -> dict[str, object]:
    """Build a proposal for server-side external-action authorisation.

    The runtime does not execute the action. It sends the resolved immutable revision, the model's
    invocation identifier, canonical argument digest, and parsed arguments so server authority can
    revalidate and either refuse, defer, or execute through its governed tool boundary.
    """
    return {
        **coordinates,
        "candidateId": str(uuid.uuid4()),
        "kind": "external_action",
        "toolRevisionId": tool_revision_id,
        "toolInvocationId": tool_invocation_id,
        "argumentsDigest": digest,
        "arguments": arguments,
    }


def resolve_tool_revision(compiled_input: dict[str, object], tool_name: str) -> str | None:
    """Resolve a model-visible tool name only from the immutable compiled grant set.

    No registry, network lookup, or model-supplied revision is accepted here. A missing or malformed
    mapping returns ``None`` and therefore cannot become an external-action candidate.
    """
    tools = compiled_input.get("tools")
    if not isinstance(tools, list):
        return None
    for tool in tools:
        if isinstance(tool, dict) and tool.get("name") == tool_name:
            revision = tool.get("toolRevisionId")
            return revision if isinstance(revision, str) else None
    return None


def tool_call_candidate(
    coordinates: dict[str, object],
    compiled_input: dict[str, object],
    neutral_event: dict[str, object],
) -> dict[str, object]:
    """Convert one neutral tool call into an external action or bounded error event.

    Parsing happens before revision resolution so malformed JSON is distinguishable from an
    ungranted tool. The server still validates the argument schema and digest at its own authority
    boundary; parsing here does not grant permission.
    """
    tool_name = neutral_event.get("toolName")
    tool_call_id = neutral_event.get("toolCallId")
    raw_arguments = neutral_event.get("arguments")
    if (
        not isinstance(tool_name, str)
        or not isinstance(tool_call_id, str)
        or not isinstance(raw_arguments, str)
    ):
        # Never include raw malformed fields in the error payload; they may contain model content.
        return candidate(coordinates, "run.error", {"reason": "malformed_tool_call"})
    try:
        arguments = json.loads(raw_arguments)
    except json.JSONDecodeError:
        return candidate(
            coordinates,
            "run.error",
            {"reason": "malformed_tool_call", "toolCallId": tool_call_id},
        )
    tool_revision_id = resolve_tool_revision(compiled_input, tool_name)
    if tool_revision_id is None:
        # A model naming an absent tool is an observable loop error, not a request to discover or
        # dynamically grant that tool.
        return candidate(
            coordinates,
            "run.error",
            {"reason": "unknown_tool", "toolCallId": tool_call_id},
        )
    return external_action_candidate(
        coordinates,
        tool_revision_id,
        tool_call_id,
        arguments_digest(arguments),
        arguments,
    )


def normalize_event(
    neutral_event: dict[str, object],
) -> tuple[str, dict[str, object]] | None:
    """Map supported non-tool events onto stable protocol names and bounded payloads.

    Unknown event types are dropped and only their type name is logged. Logging the complete unknown
    event could expose model content or framework internals while still failing to create a valid
    protocol contract.
    """
    kind = neutral_event.get("type")
    if kind == "output_text":
        text = neutral_event.get("text")
        return ("run.output_text", {"text": text if isinstance(text, str) else ""})
    if kind == "usage":
        return (
            "run.usage",
            {
                "inputTokens": _non_negative_int(neutral_event.get("inputTokens")),
                "outputTokens": _non_negative_int(neutral_event.get("outputTokens")),
            },
        )
    if kind == "error":
        message = neutral_event.get("message")
        return (
            "run.error",
            {
                "reason": "model_loop_error",
                "detail": message if isinstance(message, str) else "",
            },
        )
    log("framework_event_dropped", event_type=kind if isinstance(kind, str) else "")
    return None


def _non_negative_int(value: object) -> int:
    """Coerce an untrusted framework usage counter to a safe non-negative integer."""
    return value if isinstance(value, int) and value >= 0 else 0
