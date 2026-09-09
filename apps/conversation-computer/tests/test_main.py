"""Test private model-step transport, polling, and conversation-computer readiness."""

from __future__ import annotations

import os
import sys
import tempfile
import unittest
import json
import threading
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import src.main as computer_main
from src.main import _HealthHandler, _bootstrap, _configuration, _execute_turn, _install_review_credential, _restore


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
        self.assertEqual(open_url.call_args.kwargs, {"timeout": 30})

    @patch("src.main._read_token", return_value="projected-token")
    @patch("src.main._json_request")
    def test_requests_only_the_reserved_first_server_model_step(self, exchange: MagicMock, _token: MagicMock) -> None:
        """Send only the bootstrap and ordinal with the current projected token."""
        config = {"internalEndpoint": "http://server:8081", "tokenPath": "/token"}
        for outcome in ("completed", "pending", "response_unavailable", "authority_ended"):
            with self.subTest(outcome=outcome):
                exchange.reset_mock()
                exchange.return_value = {"outcome": outcome}
                self.assertEqual(_execute_turn(config, {"bootstrapId": "bootstrap-1", "outcome": "ready"}), outcome)
                exchange.assert_called_once_with("http://server:8081/api/internal/conversation-computer/model-step", "projected-token", {"bootstrapId": "bootstrap-1", "ordinal": 1})

    @patch("src.main._read_token", return_value="projected-token")
    @patch("src.main._json_request")
    def test_rejects_invalid_model_step_outcomes(self, exchange: MagicMock, _token: MagicMock) -> None:
        """Do not treat malformed or widened server responses as completion."""
        for response in ({}, {"outcome": "ready"}, {"outcome": []}, {"outcome": "completed", "text": "untrusted"}):
            with self.subTest(response=response):
                exchange.return_value = response
                with self.assertRaisesRegex(RuntimeError, "invalid outcome"):
                    _execute_turn({"internalEndpoint": "http://server", "tokenPath": "/token"}, {"bootstrapId": "bootstrap-1", "outcome": "ready"})

    @patch("src.main._json_request")
    def test_requires_a_ready_exact_bootstrap_before_model_step(self, exchange: MagicMock) -> None:
        """Refuse pending turns and missing or altered retry coordinates before any request."""
        for bootstrap in ({"bootstrapId": "bootstrap-1", "outcome": "pending"}, {"outcome": "ready"}, {"bootstrapId": " ", "outcome": "ready"}, {"bootstrapId": 1, "outcome": "ready"}):
            with self.subTest(bootstrap=bootstrap):
                with self.assertRaises(RuntimeError):
                    _execute_turn({"internalEndpoint": "http://server", "tokenPath": "/token"}, bootstrap)
        exchange.assert_not_called()

    @patch("src.main._read_token", return_value="projected-token")
    @patch("src.main._json_request")
    def test_accepts_only_credential_free_bootstrap_statuses(self, exchange: MagicMock, _token: MagicMock) -> None:
        """Require the closed status envelope without model content or credentials."""
        config = {"computerId": "computer-1", "generation": "1", "leaseId": "lease-1", "internalEndpoint": "http://server", "tokenPath": "/token"}
        for outcome in ("ready", "pending", "response_unavailable"):
            exchange.return_value = {"bootstrapId": "bootstrap-1", "outcome": outcome}
            self.assertEqual(_bootstrap(config), exchange.return_value)
        for response in ({"outcome": "ready"}, {"bootstrapId": "bootstrap-1", "outcome": "ready", "modelCredential": {}}, {"bootstrapId": "bootstrap-1", "outcome": "unknown"}, {"bootstrapId": "bootstrap-1", "outcome": []}):
            with self.subTest(response=response):
                exchange.return_value = response
                with self.assertRaises(RuntimeError):
                    _bootstrap(config)

    @patch("src.main._read_token", return_value="projected-token")
    @patch("src.main._json_request", return_value={"reviewCredential": "keyed-review-secret"})
    def test_installs_the_server_derived_review_credential_as_a_private_file(self, exchange: MagicMock, _token: MagicMock) -> None:
        """Ask the private route with lease coordinates and write only its secret where the review surface reads."""
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
    def test_requests_exact_checkpoint_restore_before_turns(self, exchange: MagicMock, _token: MagicMock) -> None:
        """Send immutable computer and lease coordinates while leaving Pod identity to TokenReview."""
        config = {"computerId": "computer-1", "generation": "2", "internalEndpoint": "http://server:8081", "leaseId": "lease-2", "tokenPath": "/token"}
        self.assertEqual(_restore(config), {"outcome": "restored"})
        self.assertEqual(exchange.call_args.args[2], {"computerId": "computer-1", "generation": 2, "leaseId": "lease-2"})

    @patch("src.main._read_token", side_effect=["bootstrap-token", "model-step-token"])
    def test_executes_real_http_turn_boundaries(self, _token: MagicMock) -> None:
        """Use the private server for both status and model work with freshly read Pod tokens."""
        received: list[tuple[str, str, dict[str, object]]] = []

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self) -> None:
                received.append((self.path, self.headers.get("authorization", ""), {}))
                self.reply({"bootstrapId": "bootstrap-1", "outcome": "ready"})

            def do_POST(self) -> None:
                length = int(self.headers.get("content-length", "0"))
                body = json.loads(self.rfile.read(length))
                received.append((self.path, self.headers.get("authorization", ""), body))
                self.reply({"outcome": "completed"})

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
            config = {"computerId": "computer-1", "generation": "1", "leaseId": "lease-1", "internalEndpoint": f"http://127.0.0.1:{server.server_port}", "tokenPath": "/token"}
            self.assertEqual(_execute_turn(config, _bootstrap(config)), "completed")
        finally:
            server.shutdown()
            server.server_close()
        self.assertEqual(received, [
            ("/api/internal/conversation-computer/bootstrap?computerId=computer-1&generation=1&leaseId=lease-1", "Bearer bootstrap-token", {}),
            ("/api/internal/conversation-computer/model-step", "Bearer model-step-token", {"bootstrapId": "bootstrap-1", "ordinal": 1}),
        ])


class TurnPollingTests(unittest.TestCase):
    """Keep unresolved paid work visible while polling only the server's saved status."""

    def tearDown(self) -> None:
        computer_main._LAST_FAILURE_TYPE = None

    def test_pending_bootstrap_polls_at_normal_cadence_without_model_work(self) -> None:
        """A pending reservation does not authorise another model request."""
        with patch("src.main._configuration", return_value={}), patch("src.main._install_review_credential") as review, patch("src.main._restore") as restore, patch("src.main._bootstrap", return_value={"bootstrapId": "bootstrap-1", "outcome": "pending"}) as bootstrap, patch("src.main._execute_turn") as execute, patch("src.main.time.sleep", side_effect=[None, StopIteration]) as sleep:
            with self.assertRaises(StopIteration):
                computer_main._turn_loop()
        self.assertEqual(bootstrap.call_count, 2)
        self.assertEqual([call.args for call in sleep.call_args_list], [(2,), (2,)])
        review.assert_called_once()
        restore.assert_called_once()
        execute.assert_not_called()
        self.assertIsNone(computer_main._LAST_FAILURE_TYPE)

    def test_unavailable_or_ended_step_stays_degraded_without_resubmission(self) -> None:
        """Remember the stopped bootstrap through pending or repeated-ready status polls."""
        for outcome in ("response_unavailable", "authority_ended"):
            with self.subTest(outcome=outcome):
                computer_main._LAST_FAILURE_TYPE = None
                statuses: list[str | None] = []

                def observe_sleep(_seconds: int) -> None:
                    statuses.append(computer_main._LAST_FAILURE_TYPE)
                    if len(statuses) == 3:
                        raise StopIteration

                polls = [{"bootstrapId": "bootstrap-1", "outcome": state} for state in ("ready", "pending", "ready")]
                with patch("src.main._configuration", return_value={}), patch("src.main._install_review_credential"), patch("src.main._restore"), patch("src.main._bootstrap", side_effect=polls), patch("src.main._execute_turn", return_value=outcome) as execute, patch("src.main._LOGGER.warning") as warning, patch("src.main.time.sleep", side_effect=observe_sleep):
                    with self.assertRaises(StopIteration):
                        computer_main._turn_loop()
                execute.assert_called_once()
                warning.assert_called_once()
                self.assertEqual(statuses, [outcome, outcome, outcome])

    def test_restart_reads_unavailable_status_without_model_work(self) -> None:
        """A fresh process learns the durable refusal from bootstrap and leaves its call untouched."""
        with patch("src.main._configuration", return_value={}), patch("src.main._install_review_credential"), patch("src.main._restore"), patch("src.main._bootstrap", return_value={"bootstrapId": "bootstrap-1", "outcome": "response_unavailable"}), patch("src.main._execute_turn") as execute, patch("src.main._LOGGER.warning"), patch("src.main.time.sleep", side_effect=StopIteration):
            with self.assertRaises(StopIteration):
                computer_main._turn_loop()
        execute.assert_not_called()
        self.assertEqual(computer_main._LAST_FAILURE_TYPE, "response_unavailable")


if __name__ == "__main__":
    unittest.main()
