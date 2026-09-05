"""Test the conversation-computer readiness contract without opening a listener."""

from __future__ import annotations

import os
import sys
import unittest
import json
import threading
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import src.main as computer_main
from src.main import _HealthHandler, _bootstrap, _configuration, _execute_turn, _model_text


class ConfigurationTests(unittest.TestCase):
    """Prove readiness requires exact history and lease-generation coordinates."""

    def test_accepts_complete_coordinates(self) -> None:
        """Return the frozen coordinates when every release-owned value is present."""
        environment = {
            "OPENCRANE_COMPUTER_ID": "computer-1",
            "OPENCRANE_COMPUTER_GENERATION": "3",
            "OPENCRANE_COMPUTER_LEASE_ID": "lease-1",
            "OPENCRANE_INTERNAL_ENDPOINT": "http://opencrane-internal:8081",
        }
        with patch.dict(os.environ, environment, clear=True):
            self.assertEqual(_configuration(), {"computerId": "computer-1", "generation": "3", "internalEndpoint": "http://opencrane-internal:8081", "leaseId": "lease-1", "tokenPath": "/var/run/secrets/opencrane/token"})

    def test_rejects_missing_generation(self) -> None:
        """Fail readiness when the sandbox lacks a generation fence."""
        environment = {
            "OPENCRANE_COMPUTER_ID": "computer-1",
            "OPENCRANE_COMPUTER_LEASE_ID": "lease-1",
            "OPENCRANE_INTERNAL_ENDPOINT": "http://opencrane-internal:8081",
        }
        with patch.dict(os.environ, environment, clear=True):
            with self.assertRaisesRegex(RuntimeError, "OPENCRANE_COMPUTER_GENERATION is required"):
                _configuration()

    def test_extracts_assistant_text(self) -> None:
        """Accept only the first non-empty assistant message from the model response."""
        self.assertEqual(_model_text({"choices": [{"message": {"content": "hello"}}]}), "hello")
        with self.assertRaisesRegex(RuntimeError, "no assistant text"):
            _model_text({"choices": [{"message": {"content": ""}}]})

    def test_reports_a_safe_degraded_readiness_after_turn_failure(self) -> None:
        """Keep liveness up while readiness exposes only the failure class."""
        server = ThreadingHTTPServer(("127.0.0.1", 0), _HealthHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        computer_main._LAST_FAILURE_TYPE = "HTTPError"
        thread.start()
        try:
            with self.assertRaises(Exception) as failure:
                urllib.request.urlopen(f"http://127.0.0.1:{server.server_port}/readyz")
            self.assertEqual(failure.exception.code, 503)
            self.assertEqual(json.loads(failure.exception.read()), {"status": "degraded", "reason": "HTTPError"})
        finally:
            computer_main._LAST_FAILURE_TYPE = None
            server.shutdown()
            server.server_close()

    @patch("src.main._read_token", return_value="projected-token")
    @patch("src.main.urllib.request.urlopen")
    def test_treats_an_empty_bootstrap_response_as_a_healthy_idle_poll(self, open_url: MagicMock, _token: MagicMock) -> None:
        """Interpret the private router's 204 response as idle instead of a protocol failure."""
        response = MagicMock()
        response.__enter__.return_value.read.return_value = b""
        open_url.return_value = response
        result = _bootstrap({"computerId": "computer-1", "generation": "1", "leaseId": "lease-1", "internalEndpoint": "http://server", "tokenPath": "/token"})
        self.assertEqual(result, {"outcome": "idle"})

    @patch("src.main._read_token", return_value="projected-token")
    @patch("src.main._json_request")
    def test_executes_one_bound_turn(self, exchange: MagicMock, _token: MagicMock) -> None:
        """Send only compiled messages to LiteLLM and safe assistant text back to the server."""
        exchange.side_effect = [{"choices": [{"message": {"content": "answer"}}]}, {"outcome": "accepted"}]
        config = {"internalEndpoint": "http://server:8081", "tokenPath": "/token"}
        bootstrap = {"bootstrapId": "bootstrap-1", "compiledInput": {"messages": [{"role": "user", "content": "hi"}]}, "modelCredential": {"endpoint": "http://litellm:4000", "key": "sk-attempt", "model": "silo-default"}}

        _execute_turn(config, bootstrap)

        self.assertEqual(exchange.call_args_list[0].args, ("http://litellm:4000/v1/chat/completions", "sk-attempt", {"model": "silo-default", "messages": [{"role": "user", "content": "hi"}]}))
        self.assertEqual(exchange.call_args_list[1].args[0:2], ("http://server:8081/api/internal/conversation-computer/output", "projected-token"))
        self.assertEqual(exchange.call_args_list[1].args[2]["text"], "answer")

    @patch("src.main._read_token", return_value="projected-token")
    def test_executes_real_http_turn_boundaries(self, _token: MagicMock) -> None:
        """Call a real model HTTP stub and append its assistant output through a real server stub."""
        received: list[tuple[str, str, dict[str, object]]] = []

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self) -> None:
                length = int(self.headers.get("content-length", "0"))
                body = json.loads(self.rfile.read(length))
                received.append((self.path, self.headers.get("authorization", ""), body))
                response = {"choices": [{"message": {"content": "real answer"}}]} if self.path == "/v1/chat/completions" else {"outcome": "accepted"}
                encoded = json.dumps(response).encode()
                self.send_response(200)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(encoded)))
                self.end_headers()
                self.wfile.write(encoded)

            def log_message(self, _format: str, *args: object) -> None:
                return

        model = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threads = [threading.Thread(target=item.serve_forever, daemon=True) for item in (model, server)]
        for thread in threads:
            thread.start()
        try:
            bootstrap = {"bootstrapId": "bootstrap-1", "compiledInput": {"messages": [{"role": "user", "content": "hi"}]}, "modelCredential": {"endpoint": f"http://127.0.0.1:{model.server_port}", "key": "sk-attempt", "model": "silo-default"}}
            _execute_turn({"internalEndpoint": f"http://127.0.0.1:{server.server_port}", "tokenPath": "/token"}, bootstrap)
        finally:
            model.shutdown()
            server.shutdown()
            model.server_close()
            server.server_close()
        self.assertEqual(received[0][0:2], ("/v1/chat/completions", "Bearer sk-attempt"))
        self.assertEqual(received[1][0:2], ("/api/internal/conversation-computer/output", "Bearer projected-token"))
        self.assertEqual(received[1][2]["text"], "real answer")


if __name__ == "__main__":
    unittest.main()
