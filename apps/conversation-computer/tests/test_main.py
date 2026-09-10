"""Test lease preparation and conversation-computer process health."""

from __future__ import annotations

import json
import os
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.main import _HealthHandler, _configuration, _install_review_credential, _prepare_sandbox, _restore


class ConfigurationTests(unittest.TestCase):
    """Prove readiness requires the exact lease-generation coordinates."""

    def test_accepts_complete_coordinates(self) -> None:
        """Return the frozen coordinates when every release-owned value is present."""
        environment = {
            "OPENCRANE_COMPUTER_ID": "computer-1",
            "OPENCRANE_COMPUTER_GENERATION": "3",
            "OPENCRANE_COMPUTER_LEASE_ID": "lease-1",
            "OPENCRANE_INTERNAL_ENDPOINT": "http://opencrane-internal:8081",
        }
        with patch.dict(os.environ, environment, clear=True):
            self.assertEqual(_configuration(), {"computerId": "computer-1", "generation": "3", "internalEndpoint": "http://opencrane-internal:8081", "leaseId": "lease-1", "reviewCredentialPath": "/var/run/opencrane/review/credential", "tokenPath": "/var/run/secrets/opencrane/token"})

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

    def test_health_listener_reports_ready_only_with_complete_coordinates(self) -> None:
        """Keep readiness tied to the same lease coordinates used during preparation."""
        environment = {
            "OPENCRANE_COMPUTER_ID": "computer-1",
            "OPENCRANE_COMPUTER_GENERATION": "3",
            "OPENCRANE_COMPUTER_LEASE_ID": "lease-1",
            "OPENCRANE_INTERNAL_ENDPOINT": "http://opencrane-internal:8081",
        }
        server = ThreadingHTTPServer(("127.0.0.1", 0), _HealthHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with patch.dict(os.environ, environment, clear=True):
                response = urllib.request.urlopen(f"http://127.0.0.1:{server.server_port}/readyz")
                self.assertEqual(json.loads(response.read()), {"status": "ready", "computerId": "computer-1", "generation": "3"})
            with patch.dict(os.environ, {}, clear=True):
                with self.assertRaises(urllib.error.HTTPError) as failure:
                    urllib.request.urlopen(f"http://127.0.0.1:{server.server_port}/readyz")
                self.assertEqual(failure.exception.code, 503)
                self.assertEqual(json.loads(failure.exception.read()), {"status": "not_ready", "reason": "OPENCRANE_COMPUTER_ID is required"})
                failure.exception.close()
        finally:
            server.shutdown()
            server.server_close()


class LeasePreparationTests(unittest.TestCase):
    """Keep Pod startup limited to review access and fenced workspace restore."""

    @patch("src.main._read_token", return_value="projected-token")
    @patch("src.main._json_request", return_value={"reviewCredential": "keyed-review-secret"})
    def test_installs_the_server_derived_review_credential_as_a_private_file(self, exchange: MagicMock, _token: MagicMock) -> None:
        """Ask the private route with lease coordinates and write its secret for the review surface."""
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "review" / "credential"
            config = {"computerId": "computer-1", "generation": "2", "internalEndpoint": "http://server:8081", "leaseId": "lease-2", "reviewCredentialPath": str(path), "tokenPath": "/token"}
            _install_review_credential(config)
            self.assertEqual(exchange.call_args.args[0:2], ("http://server:8081/api/internal/conversation-computer/review-credential?computerId=computer-1&generation=2&leaseId=lease-2", "projected-token"))
            self.assertEqual(path.read_text(encoding="utf-8"), "keyed-review-secret")
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertFalse(path.with_name("credential.tmp").exists())
            exchange.return_value = {"outcome": "idle"}
            with self.assertRaisesRegex(RuntimeError, "no secret"):
                _install_review_credential(config)
            self.assertEqual(path.read_text(encoding="utf-8"), "keyed-review-secret")

    @patch("src.main._read_token", return_value="projected-token")
    @patch("src.main._json_request", return_value={"outcome": "restored"})
    def test_requests_exact_checkpoint_restore_coordinates(self, exchange: MagicMock, _token: MagicMock) -> None:
        """Send immutable computer and lease coordinates while leaving Pod identity to TokenReview."""
        config = {"computerId": "computer-1", "generation": "2", "internalEndpoint": "http://server:8081", "leaseId": "lease-2", "tokenPath": "/token"}
        self.assertEqual(_restore(config), {"outcome": "restored"})
        exchange.assert_called_once_with("http://server:8081/api/internal/conversation-computer/checkpoint/restore", "projected-token", {"computerId": "computer-1", "generation": 2, "leaseId": "lease-2"}, empty_outcome="absent")

    def test_prepares_the_sandbox_once_in_dependency_order(self) -> None:
        """Install the secret before opening the review listener and restoring the workspace."""
        config = {"computerId": "computer-1"}
        events: list[str] = []
        with patch("src.main._configuration", return_value=config), patch("src.main._install_review_credential", side_effect=lambda _config: events.append("credential")) as credential, patch("src.main.start_review_surface", side_effect=lambda: events.append("review")) as review, patch("src.main._restore", side_effect=lambda _config: events.append("restore")) as restore:
            _prepare_sandbox()
        self.assertEqual(events, ["credential", "review", "restore"])
        credential.assert_called_once_with(config)
        review.assert_called_once_with()
        restore.assert_called_once_with(config)

    @patch("src.main._read_token", side_effect=["review-token", "restore-token"])
    def test_real_http_startup_uses_only_review_and_restore_boundaries(self, _token: MagicMock) -> None:
        """Reach only the two lease-bound server routes that isolated execution still needs."""
        received: list[tuple[str, str, dict[str, object]]] = []

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self) -> None:
                received.append((self.path, self.headers.get("authorization", ""), {}))
                self.reply({"reviewCredential": "keyed-review-secret"})

            def do_POST(self) -> None:
                length = int(self.headers.get("content-length", "0"))
                body = json.loads(self.rfile.read(length))
                received.append((self.path, self.headers.get("authorization", ""), body))
                self.reply({"outcome": "restored"})

            def reply(self, response: dict[str, str]) -> None:
                encoded = json.dumps(response).encode()
                self.send_response(200)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(encoded)))
                self.end_headers()
                self.wfile.write(encoded)

            def log_message(self, _format: str, *args: object) -> None:
                return

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with tempfile.TemporaryDirectory() as directory:
                config = {"computerId": "computer-1", "generation": "1", "leaseId": "lease-1", "internalEndpoint": f"http://127.0.0.1:{server.server_port}", "reviewCredentialPath": str(Path(directory) / "credential"), "tokenPath": "/token"}
                _install_review_credential(config)
                self.assertEqual(_restore(config), {"outcome": "restored"})
        finally:
            server.shutdown()
            server.server_close()
        self.assertEqual(received, [
            ("/api/internal/conversation-computer/review-credential?computerId=computer-1&generation=1&leaseId=lease-1", "Bearer review-token", {}),
            ("/api/internal/conversation-computer/checkpoint/restore", "Bearer restore-token", {"computerId": "computer-1", "generation": 1, "leaseId": "lease-1"}),
        ])


if __name__ == "__main__":
    unittest.main()
