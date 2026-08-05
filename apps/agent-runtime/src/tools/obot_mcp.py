"""Invoke one approved MCP tool directly against Obot with the attempt-scoped key.

This is the runtime's ONLY direct tool data plane: after the control plane approves a deferred tool
call, the runtime executes it against Obot's MCP proxy itself so tool payloads never transit the
OpenCrane server. Authority still lives server-side — the attempt key is scoped to the exact MCP
server ids of the run's integration assignments and expires with the assignment lease, and the
caller re-checks the compiled allow-list before reaching this module.

stdlib only (urllib): the runtime carries no HTTP client dependency. Exceptions carry type names and
static messages only — never a response body, tool payload, or the bearer key.
"""

import json
from urllib.request import Request, urlopen

from ..constants import MAX_FRAME_BYTES

# MCP protocol revision announced during the streamable-HTTP initialize exchange.
MCP_PROTOCOL_VERSION = "2025-06-18"


class ObotInvocationError(RuntimeError):
    """Transport or HTTP failure while invoking a tool through Obot."""


class ObotProtocolError(ObotInvocationError):
    """Obot answered outside the expected MCP JSON-RPC protocol."""


def invoke_tool(
    base_url: str,
    key: str,
    mcp_server_id: str,
    tool_name: str,
    arguments: object,
    timeout_s: float,
) -> object:
    """Execute one approved ``tools/call`` against Obot's MCP proxy and return its result.

    Performs the minimal streamable-HTTP MCP handshake: ``initialize`` (echoing any
    ``mcp-session-id`` response header on the follow-up), then ``tools/call``. Obot may answer
    either request with immediate JSON or a ``text/event-stream`` body; both are supported by
    parsing the first ``data:`` JSON-RPC response. Responses are bounded to the shared 64 KiB frame
    ceiling and only HTTP 200 is accepted — urllib raises for every error status, and a redirected
    POST raises rather than being followed.

    Returns:
        The JSON-RPC ``result`` object (its ``content`` carries the tool output).

    Raises:
        ObotInvocationError: On transport, HTTP, oversize, or protocol failures. The message never
            contains response content or the key.
    """
    endpoint = f"{base_url.rstrip('/')}/mcp-connect/{mcp_server_id}/mcp"

    initialize = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": MCP_PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": {"name": "opencrane-agent-runtime", "version": "1"},
        },
    }
    initialized, session_id = _post_json_rpc(endpoint, key, initialize, None, timeout_s)
    if not isinstance(initialized.get("result"), dict):
        raise ObotProtocolError("Obot MCP initialize returned no result")

    call = {"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": tool_name, "arguments": arguments}}
    answered, _ = _post_json_rpc(endpoint, key, call, session_id, timeout_s)
    if "error" in answered:
        raise ObotProtocolError("Obot MCP tools/call returned a JSON-RPC error")
    result = answered.get("result")
    if not isinstance(result, dict) or "content" not in result:
        raise ObotProtocolError("Obot MCP tools/call returned no content result")
    return result


def _post_json_rpc(
    endpoint: str,
    key: str,
    payload: dict[str, object],
    session_id: str | None,
    timeout_s: float,
) -> tuple[dict[str, object], str | None]:
    """POST one JSON-RPC request and return the parsed response with any session header.

    The bearer key exists only in the request header. Status, size, and shape are all validated
    before any field is consumed, so a surprising proxy response becomes a typed error rather than
    a fabricated tool result.
    """
    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
    }
    if session_id is not None:
        headers["mcp-session-id"] = session_id
    request = Request(endpoint, data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST")
    with urlopen(request, timeout=timeout_s) as response:
        if response.status != 200:
            raise ObotInvocationError(f"Obot MCP endpoint returned unexpected status {response.status}")
        body = response.read(MAX_FRAME_BYTES + 1)
        if len(body) > MAX_FRAME_BYTES:
            raise ObotInvocationError("Obot MCP response exceeds the 64KiB boundary")
        content_type = str(response.headers.get("Content-Type", ""))
        next_session_id = response.headers.get("mcp-session-id") or session_id
    return _parse_json_rpc_body(body, content_type), next_session_id


def _parse_json_rpc_body(body: bytes, content_type: str) -> dict[str, object]:
    """Parse an immediate-JSON or event-stream JSON-RPC body into one response object."""
    try:
        if content_type.startswith("text/event-stream"):
            parsed = _first_event_stream_data(body)
        else:
            parsed = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        # Only the failure type is preserved; the undecodable body must not enter the message.
        raise ObotProtocolError(f"Obot MCP response is not valid JSON ({type(error).__name__})") from None
    if not isinstance(parsed, dict):
        raise ObotProtocolError("Obot MCP response is not a JSON-RPC object")
    return parsed


def _first_event_stream_data(body: bytes) -> object:
    """Extract and parse the first ``data:`` line of a server-sent-events response body."""
    for raw_line in body.split(b"\n"):
        line = raw_line.rstrip(b"\r")
        if line.startswith(b"data:"):
            return json.loads(line[len(b"data:"):].strip().decode("utf-8"))
    raise ObotProtocolError("Obot MCP event stream carried no data frame")
