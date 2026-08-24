"""Prove the simulated profile retains runtime flow without model network access."""

import json
import os
import threading
import unittest
from pathlib import Path
from unittest import mock

from src.development.deterministic_model import (
    deterministic_event_source,
    deterministic_resume_event_source,
)
from src.development_runtime import _LITELLM_STRATEGY, _SIMULATED_STRATEGY, development_open_stream


def _compiled_input(message: str) -> dict[str, object]:
    """Build the model fields consumed by the deterministic neutral-event strategy."""
    return {"messages": [{"role": "user", "content": message}]}


class DeterministicModelStrategyTests(unittest.TestCase):
    """Validate stable chat and resume events without importing a model provider."""

    def test_plain_chat_returns_stable_text_and_usage(self) -> None:
        """The same accepted input always produces the same neutral events."""
        source = _compiled_input("Hello")
        first = list(deterministic_event_source(source, threading.Event(), []))
        second = list(deterministic_event_source(source, threading.Event(), []))

        self.assertEqual(first, second)
        self.assertEqual(first[0], {"type": "output_text", "text": "Simulated agent response: Hello"})
        self.assertEqual(first[1], {"type": "usage", "inputTokens": 0, "outputTokens": 0})

    def test_resume_uses_only_already_authorised_results(self) -> None:
        """The deterministic resume adapter displays accepted participant input without new work."""
        events = list(deterministic_resume_event_source({}, {"request-1": {"response": "confirmed"}}, threading.Event(), ["continue"]))

        self.assertEqual(events[0]["type"], "output_text")
        self.assertIn('"response":"confirmed"', str(events[0]["text"]))
        self.assertIn("Steering: continue", str(events[0]["text"]))


class DevelopmentRuntimeCompositionTests(unittest.TestCase):
    """Validate that each development strategy selects the intended existing stream handlers."""

    @mock.patch("src.development_runtime.open_stream")
    def test_litellm_strategy_keeps_production_handlers(self, open_stream_mock: mock.Mock) -> None:
        """Alternatives A and B call the existing stream composition unchanged."""
        open_stream_mock.return_value = 0

        with mock.patch.dict(os.environ, {"OPENCRANE_RUNTIME_MODEL_STRATEGY": "litellm"}, clear=False):
            result = development_open_stream("http://server", "runtime-token", "instance", "pod")

        self.assertEqual(result, 0)
        open_stream_mock.assert_called_once_with("http://server", "runtime-token", "instance", "pod")

    @mock.patch("src.development_runtime.open_stream")
    def test_simulated_strategy_injects_handlers_without_provider_access(self, open_stream_mock: mock.Mock) -> None:
        """Alternative C changes only event sources after normal stream admission."""
        open_stream_mock.return_value = 0

        with mock.patch.dict(os.environ, {"OPENCRANE_RUNTIME_MODEL_STRATEGY": "simulated"}, clear=False):
            result = development_open_stream("http://server", "runtime-token", "instance", "pod")

        self.assertEqual(result, 0)
        call = open_stream_mock.call_args
        self.assertEqual(call.args, ("http://server", "runtime-token", "instance", "pod"))
        self.assertEqual(call.kwargs["handle_start"].__name__, "_simulated_start")
        self.assertEqual(call.kwargs["handle_resume"].__name__, "_simulated_resume")

    def test_model_strategies_match_the_cross_process_profile_contract(self) -> None:
        """The Python entrypoint accepts the strategies emitted by the TypeScript controller."""
        contract_path = Path(__file__).resolve().parents[3] / "libs/models/local-development/main/profile-contract.json"
        contract = json.loads(contract_path.read_text(encoding="utf8"))

        self.assertEqual(contract["modelStrategies"], [_LITELLM_STRATEGY, _SIMULATED_STRATEGY])


if __name__ == "__main__":
    unittest.main()
