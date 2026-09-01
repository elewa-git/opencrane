"""Test the fixed ConversationComputer Sandbox bootstrap exchange without a cluster."""

import json
import io
import unittest
from urllib.error import HTTPError

from src.conversation_computer.bootstrap import (
    ConversationComputerBootstrapDeniedError,
    ConversationComputerBootstrapSettings,
    bootstrap_execution,
    read_bootstrap_settings,
)


class _Response:
    """Provide the minimal successful HTTP response shape used by the bootstrap client."""

    status = 200

    def __init__(self, body: object) -> None:
        self._body = json.dumps(body).encode("utf-8")

    def __enter__(self) -> "_Response":
        return self

    def __exit__(self, *_arguments: object) -> None:
        return None

    def read(self) -> bytes:
        return self._body


class ConversationComputerBootstrapTests(unittest.TestCase):
    """Prove that the runtime accepts only the exact mounted and server-derived contract."""

    def test_reads_the_fixed_mount_contract(self) -> None:
        """The runtime obtains its computer identity only from the admission-stamped Pod label."""
        files = {
            "/var/run/opencrane/conversation-computer/endpoint": "http://server/runtime\n",
            "/var/run/opencrane/conversation-computer/protocol-version": "conversation-computer-runtime.v1\n",
            "/var/run/opencrane/conversation-computer/token-audience": "opencrane-conversation-computer-runtime\n",
        }

        settings = read_bootstrap_settings(files.__getitem__, lambda name: "computer-1" if name == "OPENCRANE_CONVERSATION_COMPUTER_ID" else None)

        self.assertEqual(settings, ConversationComputerBootstrapSettings(endpoint="http://server/runtime", computer_id="computer-1", token_path="/var/run/secrets/opencrane/conversation-computer/token"))

    def test_rejects_a_substituted_protocol_contract(self) -> None:
        """A mounted protocol downgrade ends the runtime before it can send its token."""
        files = {
            "/var/run/opencrane/conversation-computer/endpoint": "http://server/runtime",
            "/var/run/opencrane/conversation-computer/protocol-version": "conversation-computer-runtime.v0",
            "/var/run/opencrane/conversation-computer/token-audience": "opencrane-conversation-computer-runtime",
        }

        with self.assertRaises(ConversationComputerBootstrapDeniedError):
            read_bootstrap_settings(files.__getitem__, lambda _name: "computer-1")

    def test_rejects_a_mount_endpoint_without_a_network_authority(self) -> None:
        """A malformed immutable endpoint cannot become a retryable request failure."""
        files = {
            "/var/run/opencrane/conversation-computer/endpoint": "http:",
            "/var/run/opencrane/conversation-computer/protocol-version": "conversation-computer-runtime.v1",
            "/var/run/opencrane/conversation-computer/token-audience": "opencrane-conversation-computer-runtime",
        }

        with self.assertRaises(ConversationComputerBootstrapDeniedError):
            read_bootstrap_settings(files.__getitem__, lambda _name: "computer-1")

    def test_accepts_only_the_matching_server_execution(self) -> None:
        """The bootstrap request sends only the Downward-API computer id and verifies its echo."""
        settings = ConversationComputerBootstrapSettings("http://server/runtime", "computer-1", "/token")
        captured: list[object] = []

        def _open(request: object) -> _Response:
            captured.append(request)
            return _Response({"computerId": "computer-1", "conversationId": "conversation-1", "executionId": "execution-1", "leaseGeneration": 2})

        execution = bootstrap_execution(settings, lambda _path: "token-value", _open)

        self.assertEqual(execution.execution_id, "execution-1")
        self.assertEqual(json.loads(captured[0].data.decode("utf-8")), {"computerId": "computer-1"})

    def test_rejects_a_foreign_computer_response(self) -> None:
        """A server response cannot move this Pod onto another admitted computer execution."""
        settings = ConversationComputerBootstrapSettings("http://server/runtime", "computer-1", "/token")

        with self.assertRaises(ConversationComputerBootstrapDeniedError):
            bootstrap_execution(settings, lambda _path: "token-value", lambda _request: _Response({"computerId": "computer-2", "conversationId": "conversation-1", "executionId": "execution-1", "leaseGeneration": 2}))

    def test_treats_an_identity_refusal_as_permanent(self) -> None:
        """Retrying a denied Pod cannot create a new lease or recover a revoked identity."""
        settings = ConversationComputerBootstrapSettings("http://server/runtime", "computer-1", "/token")

        def _deny(_request: object) -> object:
            raise HTTPError("http://server/runtime/bootstrap", 403, "denied", {}, io.BytesIO())

        with self.assertRaises(ConversationComputerBootstrapDeniedError):
            bootstrap_execution(settings, lambda _path: "token-value", _deny)


if __name__ == "__main__":
    unittest.main()
