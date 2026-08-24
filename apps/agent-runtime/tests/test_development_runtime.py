"""Prove the simulated profile retains runtime flow without model network access."""

import os
import tempfile
import threading
import unittest
from unittest import mock

from src.development.deterministic_model import (
    deterministic_event_source,
    deterministic_resume_event_source,
)
from src.development_runtime import development_open_stream
from src.attempts.execution import execute_resume_attempt, execute_start_attempt


def _compiled_input(message: str, tools: list[dict[str, object]] | None = None) -> dict[str, object]:
    """Build the model fields consumed by the deterministic neutral-event strategy."""
    return {
        "messages": [{"role": "user", "content": message}],
        "tools": tools or [],
    }


class _TestCipher:
    """Provide reversible checkpoint encryption without requiring runtime dependencies in unit tests."""

    def encrypt(self, data: bytes) -> bytes:
        """Prefix and reverse the checkpoint bytes."""
        return b"test:" + data[::-1]

    def decrypt(self, token: bytes) -> bytes:
        """Reverse bytes written by this exact test cipher."""
        if not token.startswith(b"test:"):
            raise ValueError("unexpected test checkpoint")
        return token[len(b"test:"):][::-1]


class DeterministicModelStrategyTests(unittest.TestCase):
    """Validate stable chat, tool, and resume events without importing a model provider."""

    def test_plain_chat_returns_stable_text_and_usage(self) -> None:
        """The same accepted input always produces the same neutral events."""
        source = _compiled_input("Hello")
        first = list(deterministic_event_source(source, threading.Event(), []))
        second = list(deterministic_event_source(source, threading.Event(), []))

        self.assertEqual(first, second)
        self.assertEqual(first[0], {"type": "output_text", "text": "Simulated agent response: Hello"})
        self.assertEqual(first[1], {"type": "usage", "inputTokens": 0, "outputTokens": 0})

    def test_explicit_tool_directive_uses_only_compiled_grant(self) -> None:
        """A simulated tool proposal keeps the external-action path bound to the frozen tool set."""
        tools = [{"name": "search"}]
        events = list(deterministic_event_source(_compiled_input('/simulate-tool search {"q":"opencrane"}', tools), threading.Event(), []))

        self.assertEqual(events[0], {
            "type": "tool_call",
            "toolName": "search",
            "toolCallId": "simulated-tool-call-1",
            "arguments": '{"q":"opencrane"}',
        })
        with self.assertRaises(ValueError):
            list(deterministic_event_source(_compiled_input("/simulate-tool unknown {}", tools), threading.Event(), []))

    def test_resume_uses_only_already_authorised_results(self) -> None:
        """The deterministic resume adapter displays its input and performs no tool operation."""
        events = list(deterministic_resume_event_source({}, {"simulated-tool-call-1": {"ok": True}}, threading.Event(), ["continue"]))

        self.assertEqual(events[0]["type"], "output_text")
        self.assertIn('"ok":true', str(events[0]["text"]))
        self.assertIn("Steering: continue", str(events[0]["text"]))

    def test_tool_start_and_resume_use_the_existing_candidate_pipeline(self) -> None:
        """Simulated work pauses on a real external-action candidate and resumes from its saved result."""
        compiled_input = {
            "promptCompilerVersion": "v1",
            "runId": "simulated-run",
            "attempt": 1,
            "instructions": "Use the compiled tools.",
            "messages": [{"role": "user", "content": '/simulate-tool search {"q":"OpenCrane"}'}],
            "tools": [{
                "name": "search",
                "toolRevisionId": "revision-search",
                "description": "Search a local fixture.",
                "requiresApproval": False,
                "parametersSchema": {"type": "object"},
            }],
            "model": {"modelAlias": "simulated", "maxOutputTokens": None, "generatedOutputCapabilities": []},
            "budget": {},
            "digest": "sha256:simulated",
        }
        start = {
            "kind": "start_attempt",
            "commandId": "start-simulated",
            "fence": 1,
            "assignment": {"runId": "simulated-run", "attempt": 1},
            "payload": {"snapshot": {"inputGeneration": 4}, "compiledInput": compiled_input},
        }
        resume = {
            "kind": "resume_attempt",
            "commandId": "resume-simulated",
            "fence": 2,
            "assignment": {"runId": "simulated-run", "attempt": 1},
            "payload": {
                "inputGeneration": 4,
                "toolResults": [{
                    "toolInvocationId": "simulated-tool-call-1",
                    "outcome": "succeeded",
                    "result": {"answer": "fixture result"},
                }],
                "steeringRequests": [],
                "elicitationResults": [],
            },
        }
        emitted: list[dict[str, object]] = []
        cipher = _TestCipher()

        with tempfile.TemporaryDirectory() as checkpoint_dir:
            with mock.patch.dict(os.environ, {"OPENCRANE_RUNTIME_CHECKPOINT_DIR": checkpoint_dir}, clear=False):
                execute_start_attempt(start, "instance-simulated", emitted.append, event_source=deterministic_event_source, checkpoint_cipher=cipher)
                self.assertIn("external_action", [candidate["kind"] for candidate in emitted])

                execute_resume_attempt(resume, "instance-simulated", emitted.append, resume_event_source=deterministic_resume_event_source, checkpoint_cipher=cipher)

        self.assertIn("run.resumed", [candidate.get("eventType") for candidate in emitted])
        self.assertEqual(emitted[-1]["eventType"], "run.completed")


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


if __name__ == "__main__":
    unittest.main()
