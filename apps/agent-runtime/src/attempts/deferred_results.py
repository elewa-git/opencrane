"""Turn control-plane approval decisions into executed tool results for the model loop.

A ``resume_attempt`` delivers ``deferredToolResults`` as an array of
``{approvalRequestId, decision, toolInvocationId, arguments, argumentsDigest}`` records. The server
supplies the complete authority-approved replacement arguments, never an executed result body. This
module maps each record back to its pending proposed call, verifies the replacement digest, executes
an approved call directly against Obot with the attempt-scoped key,
reports a digest-only ``tool.completed`` candidate, and returns the ``{tool_call_id: result}``
mapping the Pydantic adapter feeds back into the framework as deferred tool results.

Failures are typed and fail closed: a denied decision becomes a refusal result, and a missing
pending call, missing Obot configuration, allow-list mismatch, or Obot transport failure becomes a
typed error result plus a bounded ``tool.failed`` candidate carrying no message text.
"""

from urllib.error import HTTPError, URLError

from ..config import optional_environment, read_attempt_obot_key
from ..constants import OBOT_INVOCATION_TIMEOUT_SECONDS
from ..protocol.candidates import arguments_digest, candidate
from ..tools import obot_mcp
from .pending_tools import take_pending_tool_call


def resolve_deferred_tool_results(
    coordinates: dict[str, object],
    compiled_input: dict[str, object],
    deferred_tool_results: object,
    post_candidate,
) -> object:
    """Execute the authorized decisions and return the framework's deferred-results mapping.

    A non-list payload is passed through untouched so an unexpected control-plane shape surfaces at
    the framework seam instead of being silently repaired here.
    """
    if not isinstance(deferred_tool_results, list):
        return deferred_tool_results
    results: dict[str, object] = {}
    for entry in deferred_tool_results:
        if not isinstance(entry, dict) or not isinstance(entry.get("toolInvocationId"), str):
            # An unmappable record cannot be attached to any pending call; report it and move on.
            post_candidate(candidate(coordinates, "run.error", {"reason": "invalid_deferred_result"}))
            continue
        tool_invocation_id = entry["toolInvocationId"]
        if entry.get("decision") != "approved":
            # A denial consumes the pending call and feeds an explicit refusal to the model loop.
            take_pending_tool_call(str(coordinates["runId"]), int(coordinates["attempt"]), tool_invocation_id)  # type: ignore[arg-type]
            results[tool_invocation_id] = {"approved": False, "reason": "approval_denied"}
            continue
        approved_arguments = entry.get("arguments")
        approved_arguments_digest = entry.get("argumentsDigest")
        if (
            not isinstance(approved_arguments, dict)
            or not isinstance(approved_arguments_digest, str)
            or arguments_digest(approved_arguments) != approved_arguments_digest
        ):
            take_pending_tool_call(str(coordinates["runId"]), int(coordinates["attempt"]), tool_invocation_id)  # type: ignore[arg-type]
            post_candidate(candidate(coordinates, "tool.failed", {"reason": "invalid_deferred_result", "toolInvocationId": tool_invocation_id}))
            results[tool_invocation_id] = {"error": "invalid_deferred_result"}
            continue
        results[tool_invocation_id] = _execute_approved_call(coordinates, compiled_input, tool_invocation_id, approved_arguments, post_candidate)
    return results


def _execute_approved_call(
    coordinates: dict[str, object],
    compiled_input: dict[str, object],
    tool_invocation_id: str,
    approved_arguments: dict[str, object],
    post_candidate,
) -> object:
    """Execute one authoritative replacement argument object and report its digest-only completion."""
    pending = take_pending_tool_call(str(coordinates["runId"]), int(coordinates["attempt"]), tool_invocation_id)  # type: ignore[arg-type]
    if pending is None:
        post_candidate(candidate(coordinates, "tool.failed", {"reason": "unknown_tool_invocation", "toolInvocationId": tool_invocation_id}))
        return {"error": "unknown_tool_invocation"}

    # Direct execution is optional deployment capability: without both settings, approved
    # integration tools fail with a typed loop error instead of any implicit fallback path.
    base_url = optional_environment("OPENCRANE_RUNTIME_OBOT_URL")
    key_path = optional_environment("OPENCRANE_RUNTIME_OBOT_KEY_PATH")
    if base_url is None or key_path is None:
        post_candidate(candidate(coordinates, "tool.failed", {"reason": "obot_invocation_failed", "toolInvocationId": tool_invocation_id}))
        return {"error": "obot_unavailable"}

    # Defense in depth: the approved name must still resolve in the immutable compiled grant set,
    # carry Obot addressing, and follow the integration revision grammar for its bare MCP name.
    addressing = _tool_addressing(compiled_input, pending.get("toolName"))
    if addressing is None:
        post_candidate(candidate(coordinates, "tool.failed", {"reason": "tool_not_allowed", "toolInvocationId": tool_invocation_id}))
        return {"error": "tool_not_allowed"}
    mcp_server_id, mcp_tool_name = addressing
    post_candidate(candidate(coordinates, "tool.started", {"toolInvocationId": tool_invocation_id, "toolCallId": tool_invocation_id}))

    try:
        result = obot_mcp.invoke_tool(
            base_url,
            read_attempt_obot_key(key_path),
            mcp_server_id,
            mcp_tool_name,
            approved_arguments,
            OBOT_INVOCATION_TIMEOUT_SECONDS,
        )
    except (HTTPError, URLError, OSError, RuntimeError, ValueError) as error:
        # Type name only: Obot errors and URLs never enter a candidate or the model context verbatim.
        post_candidate(candidate(coordinates, "tool.failed", {"reason": "obot_invocation_failed", "toolInvocationId": tool_invocation_id, "errorType": type(error).__name__}))
        return {"error": "obot_invocation_failed", "errorType": type(error).__name__}

    # Digest-only receipt: the server marks the reservation Succeeded from this candidate without
    # the tool content ever transiting or being persisted by the control plane.
    post_candidate(candidate(coordinates, "tool.completed", {"toolInvocationId": tool_invocation_id, "toolCallId": tool_invocation_id, "resultDigest": arguments_digest(result)}))
    return result


def _tool_addressing(compiled_input: dict[str, object], tool_name: object) -> tuple[str, str] | None:
    """Resolve one compiled integration tool into its Obot server id and bare MCP tool name."""
    tools = compiled_input.get("tools")
    if not isinstance(tool_name, str) or not isinstance(tools, list):
        return None
    for tool in tools:
        if not isinstance(tool, dict) or tool.get("name") != tool_name:
            continue
        mcp_server_id = tool.get("obotMcpServerId")
        segments = tool_name.split(":")
        if not isinstance(mcp_server_id, str) or not mcp_server_id or len(segments) != 3 or segments[0] != "integration" or not segments[2]:
            return None
        return (mcp_server_id, segments[2])
    return None
