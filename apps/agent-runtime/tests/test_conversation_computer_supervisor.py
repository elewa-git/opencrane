"""Test ConversationComputer bootstrap retry policy without a server or model loop."""

import unittest
from urllib.error import URLError

from src.conversation_computer.bootstrap import (
    ConversationComputerBootstrapDeniedError,
    ConversationComputerBootstrapSettings,
    ConversationComputerExecution,
)
from src.conversation_computer.supervisor import run


class ConversationComputerSupervisorTests(unittest.TestCase):
    """Prove bootstrap retries cannot become a local execution-selection mechanism."""

    _SETTINGS = ConversationComputerBootstrapSettings("http://server/runtime", "computer-1", "/token")
    _EXECUTION = ConversationComputerExecution("computer-1", "conversation-1", "execution-1", 2)

    def test_denial_never_starts_the_loop(self) -> None:
        """A denied Pod exits instead of retrying or borrowing another computer execution."""
        started: list[ConversationComputerExecution] = []

        def _deny(_settings: ConversationComputerBootstrapSettings) -> ConversationComputerExecution:
            raise ConversationComputerBootstrapDeniedError("denied")

        run(self._SETTINGS, _deny, started.append)

        self.assertEqual(started, [])

    def test_unavailable_bootstrap_retries_then_hands_off_once(self) -> None:
        """A transient failure rereads bootstrap state before one server-derived loop handoff."""
        attempts = 0
        waits: list[float] = []
        started: list[ConversationComputerExecution] = []

        def _bootstrap(_settings: ConversationComputerBootstrapSettings) -> ConversationComputerExecution:
            nonlocal attempts
            attempts += 1
            if attempts == 1:
                raise URLError("temporarily unavailable")
            return self._EXECUTION

        run(self._SETTINGS, _bootstrap, started.append, waits.append)

        self.assertEqual(attempts, 2)
        self.assertEqual(started, [self._EXECUTION])
        self.assertEqual(len(waits), 1)

    def test_missing_loop_adapter_refuses_runtime_startup(self) -> None:
        """Bootstrap coordinates cannot be logged or abandoned when no product loop owns them."""
        with self.assertRaisesRegex(RuntimeError, "loop adapter"):
            run(self._SETTINGS, lambda _settings: self._EXECUTION)


if __name__ == "__main__":
    unittest.main()
