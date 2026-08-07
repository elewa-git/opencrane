"""Offline tests for the direct Obot MCP invocation transport.

Fixtures are independently authored from the MCP streamable-HTTP contract; the harness reaches no
network. Both immediate-JSON and event-stream response bodies are covered, plus the bounded-read,
status, and protocol failure paths — every failure carries a type and static message only.
"""

import io
import json
import unittest
import unittest.mock

from src.tools import obot_mcp


class _FakeResponse:
    """Minimal urlopen context-manager double exposing status, headers, and a bounded body."""

    def __init__(self, body: bytes, content_type: str = "application/json", status: int = 200, session_id: str | None = None):
        self.status = status
        self._reader = io.BytesIO(body)
        self.headers = {"Content-Type": content_type}
        if session_id is not None:
            self.headers["mcp-session-id"] = session_id

    def read(self, size: int) -> bytes:
        return self._reader.read(size)

    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        return False


def _json_rpc_result(result: object) -> bytes:
    return json.dumps({"jsonrpc": "2.0", "id": 1, "result": result}).encode("utf-8")


class ObotMcpInvocationTests(unittest.TestCase):
    """Direct approved-invocation protocol behaviour."""

    def test_initialize_then_tools_call_echoes_the_session_header(self) -> None:
        """The handshake runs initialize first and echoes ``mcp-session-id`` on the tool call."""
        recorded = []
        responses = [
            _FakeResponse(_json_rpc_result({"protocolVersion": "2025-06-18"}), session_id="session-1"),
            _FakeResponse(_json_rpc_result({"content": [{"type": "text", "text": "ok"}]})),
        ]

        def _urlopen(request, timeout):
            recorded.append({"url": request.full_url, "headers": dict(request.headers), "body": json.loads(request.data.decode("utf-8")), "timeout": timeout})
            return responses.pop(0)

        with unittest.mock.patch.object(obot_mcp, "urlopen", _urlopen):
            result = obot_mcp.invoke_tool("http://obot.silo.svc.cluster.local:8080", "ok1-key", "srv-9", "create_issue", {"title": "x"}, 30.0)

        self.assertEqual(result, {"content": [{"type": "text", "text": "ok"}]})
        self.assertEqual([entry["url"] for entry in recorded], ["http://obot.silo.svc.cluster.local:8080/mcp-connect/srv-9/mcp"] * 2)
        self.assertEqual(recorded[0]["body"]["method"], "initialize")
        self.assertEqual(recorded[0]["body"]["params"]["protocolVersion"], "2025-06-18")
        self.assertEqual(recorded[1]["body"], {"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": "create_issue", "arguments": {"title": "x"}}})
        self.assertEqual(recorded[1]["headers"].get("Mcp-session-id"), "session-1")
        self.assertEqual(recorded[0]["headers"].get("Authorization"), "Bearer ok1-key")

    def test_event_stream_bodies_parse_the_first_data_frame(self) -> None:
        """An Obot streamable-HTTP answer delivered as SSE parses its first data frame."""
        stream = b"event: message\ndata: " + _json_rpc_result({"content": []}) + b"\n\n"
        responses = [
            _FakeResponse(_json_rpc_result({})),
            _FakeResponse(stream, content_type="text/event-stream"),
        ]
        with unittest.mock.patch.object(obot_mcp, "urlopen", lambda request, timeout: responses.pop(0)):
            result = obot_mcp.invoke_tool("http://obot.silo.svc.cluster.local:8080", "ok1-key", "srv-9", "list", {}, 5.0)
        self.assertEqual(result, {"content": []})

    def test_failures_are_typed_and_carry_no_response_content(self) -> None:
        """Non-200 status, oversize, JSON-RPC errors, and malformed bodies fail typed."""
        cases = [
            (_FakeResponse(b"", status=202), obot_mcp.ObotInvocationError),
            (_FakeResponse(b"x" * (obot_mcp.MAX_FRAME_BYTES + 1)), obot_mcp.ObotInvocationError),
            (_FakeResponse(b"secret-content-not-json"), obot_mcp.ObotProtocolError),
            (_FakeResponse(json.dumps({"jsonrpc": "2.0", "id": 1, "error": {"message": "secret detail"}}).encode("utf-8")), obot_mcp.ObotProtocolError),
        ]
        for response, expected in cases:
            responses = [_FakeResponse(_json_rpc_result({})), response]
            with unittest.mock.patch.object(obot_mcp, "urlopen", lambda request, timeout: responses.pop(0)):
                with self.assertRaises(expected) as raised:
                    obot_mcp.invoke_tool("http://obot.silo.svc.cluster.local:8080", "ok1-key", "srv-9", "list", {}, 5.0)
            self.assertNotIn("secret", str(raised.exception))

    def test_missing_content_result_is_a_protocol_error(self) -> None:
        """A tools/call answer without a content result never becomes a fabricated tool output."""
        responses = [_FakeResponse(_json_rpc_result({})), _FakeResponse(_json_rpc_result({"no": "content"}))]
        with unittest.mock.patch.object(obot_mcp, "urlopen", lambda request, timeout: responses.pop(0)):
            with self.assertRaises(obot_mcp.ObotProtocolError):
                obot_mcp.invoke_tool("http://obot.silo.svc.cluster.local:8080", "ok1-key", "srv-9", "list", {}, 5.0)


if __name__ == "__main__":
    unittest.main()
