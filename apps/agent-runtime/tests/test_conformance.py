"""Offline conformance harness for the OpenCrane agent runtime against a LiteLLM-compatible double.

This suite qualifies the runtime shell's observable protocol behaviour against INDEPENDENTLY AUTHORED
neutral-event fixtures fed through a mock model loop that stands in for the bounded Pydantic AI loop
over the per-silo LiteLLM proxy. Every fixture is written here from the protocol contract; none is
derived from any transcript, and the harness imports no model framework and reaches no network.

The live-LiteLLM conformance leg (driving the real, pinned ``pydantic-ai`` package against a live
proxy) is the ADR 0010 adoption gate tracked by #337. It is explicitly guarded below and skipped
offline; it is NEVER asserted as passing here. Passing this offline harness is a precondition for the
live leg, not evidence of adoption.

Dimensions covered: streaming + usage, fragmented tool-call argument reassembly, tool ordering,
malformed calls, slow progress, approvals (external action + resume), restart (checkpoint round-trip),
cancellation, provider faults, compaction/bounded payloads, budgets, and telemetry evidence.
"""

import contextlib
import importlib.util
import io
import json
import os
import tempfile
import threading
import types
import unittest

from src import runtime
from src.runtime import (
    _arguments_digest,
    _execute_resume_attempt,
    _execute_start_attempt,
    _normalize_event,
    _read_checkpoint,
    _translate_framework_event,
    _write_checkpoint,
    _zero_retry_openai_settings,
)


class _ReversingCipher:
    """A reversible in-test cipher seam so restart checkpoints round-trip without ``cryptography``."""

    def encrypt(self, data: bytes) -> bytes:
        return b"v:" + data[::-1]

    def decrypt(self, token: bytes) -> bytes:
        if not token.startswith(b"v:"):
            raise ValueError("bad token")
        return token[len(b"v:"):][::-1]


def _compiled_input() -> dict:
    """Build an independently authored compiled input fixing the ``search`` and ``write`` grants."""
    return {
        "promptCompilerVersion": "v1",
        "instructions": "answer precisely",
        "messages": [{"role": "user", "content": "hello"}],
        "tools": [
            {"name": "search", "toolRevisionId": "rev-search", "description": "", "parametersSchema": {}},
            {"name": "write", "toolRevisionId": "rev-write", "description": "", "parametersSchema": {}},
        ],
        "model": {"modelAlias": "silo-default", "maxOutputTokens": None},
        "budget": {"maxCostUsdMicros": 5_000_000},
        "digest": "sha256:conformance",
    }


def _start_command() -> dict:
    """Build one structurally valid ``start_attempt`` command carrying the compiled input fixture."""
    return {
        "kind": "start_attempt",
        "commandId": "cmd-start",
        "fence": 3,
        "assignment": {"runId": "run-conf", "attempt": 1},
        "payload": {"snapshot": {"inputGeneration": 9}, "compiledInput": _compiled_input()},
    }


def _resume_command(deferred: dict) -> dict:
    """Build one structurally valid ``resume_attempt`` command carrying authorized deferred results."""
    return {
        "kind": "resume_attempt",
        "commandId": "cmd-resume",
        "fence": 3,
        "assignment": {"runId": "run-conf", "attempt": 1},
        "payload": {"inputGeneration": 10, "deferredToolResults": deferred},
    }


def _scripted_source(events: list[dict]):
    """Return a LiteLLM-compatible mock model loop yielding a fixed neutral-event script.

    The double honours the same cancel-event and steering-buffer seam the real driver uses, so the
    runtime's cancellation and steering behaviour are exercised without a framework or a network.
    """

    def _source(_compiled: dict, cancel: threading.Event, _steering: list[str]):
        for event in events:
            if cancel.is_set():
                return
            yield event

    return _source


def _run_start(command: dict, events: list[dict], **kwargs) -> list[dict]:
    """Drive one start attempt over a scripted mock loop and return the emitted candidates."""
    emitted: list[dict] = []
    _execute_start_attempt(command, "instance-conf", emitted.append, event_source=_scripted_source(events), **kwargs)
    return emitted


def _event_types(emitted: list[dict]) -> list[str]:
    """Project the ordered event/candidate types for terse ordering assertions."""
    return [candidate.get("eventType", candidate.get("kind")) for candidate in emitted]


class ConformanceStreamingTests(unittest.TestCase):
    """Streaming output, usage accounting, and terminal ordering."""

    def test_streaming_then_usage_then_completion_is_ordered(self) -> None:
        """Text deltas surface in order, usage normalizes, and exactly one terminal closes the run."""
        emitted = _run_start(_start_command(), [
            {"type": "output_text", "text": "one "},
            {"type": "output_text", "text": "two "},
            {"type": "usage", "inputTokens": 11, "outputTokens": 4},
        ])
        self.assertEqual(_event_types(emitted), ["run.started", "run.output_text", "run.output_text", "run.usage", "run.completed"])
        self.assertEqual([candidate["payload"].get("text") for candidate in emitted if candidate.get("eventType") == "run.output_text"], ["one ", "two "])
        usage = next(candidate for candidate in emitted if candidate.get("eventType") == "run.usage")
        self.assertEqual(usage["payload"], {"inputTokens": 11, "outputTokens": 4})

    def test_slow_progress_preserves_order_and_bounds_each_event(self) -> None:
        """A long slow stream keeps per-event bounded candidates in order without accumulation."""
        deltas = [{"type": "output_text", "text": f"chunk-{index}"} for index in range(64)]
        emitted = _run_start(_start_command(), deltas)
        texts = [candidate["payload"]["text"] for candidate in emitted if candidate.get("eventType") == "run.output_text"]
        self.assertEqual(texts, [f"chunk-{index}" for index in range(64)])
        # Each streamed delta is its own bounded candidate; the runtime never concatenates a growing buffer.
        self.assertTrue(all(len(text) <= 32 for text in texts))


class ConformanceToolCallTests(unittest.TestCase):
    """Tool-call surfacing, fragmented-argument reassembly, ordering, and malformed handling."""

    def test_granted_tool_call_becomes_external_action_with_revision_and_digest(self) -> None:
        """A granted tool resolves its snapshot revision and a deterministic arguments digest."""
        emitted = _run_start(_start_command(), [{"type": "tool_call", "toolName": "search", "toolCallId": "call-1", "arguments": '{"q":"x"}'}])
        action = next(candidate for candidate in emitted if candidate["kind"] == "external_action")
        self.assertEqual(action["toolRevisionId"], "rev-search")
        self.assertEqual(action["toolInvocationId"], "call-1")
        self.assertEqual(action["argumentsDigest"], _arguments_digest({"q": "x"}))

    def test_multiple_tool_calls_preserve_model_order(self) -> None:
        """Two tool calls surface as two external actions in the exact order the model proposed them."""
        emitted = _run_start(_start_command(), [
            {"type": "tool_call", "toolName": "search", "toolCallId": "call-1", "arguments": "{}"},
            {"type": "tool_call", "toolName": "write", "toolCallId": "call-2", "arguments": "{}"},
        ])
        actions = [candidate["toolRevisionId"] for candidate in emitted if candidate["kind"] == "external_action"]
        self.assertEqual(actions, ["rev-search", "rev-write"])

    def test_fragmented_arguments_reassemble_at_the_adapter_seam(self) -> None:
        """Streamed argument fragments reassembled by the driver produce one complete neutral event.

        The adapter seam receives a framework event exposing ``args_as_json_str`` (the reassembled
        whole), so the runtime never sees partial JSON fragments. This fixture is an independently
        authored stand-in framework object, not a real framework type.
        """
        reassembled = types.SimpleNamespace(
            delta=None,
            part=types.SimpleNamespace(tool_name="search", tool_call_id="call-frag", args_as_json_str=lambda: '{"q":"reassembled"}'),
        )
        neutral = _translate_framework_event(reassembled)
        self.assertEqual(neutral, {"type": "tool_call", "toolName": "search", "toolCallId": "call-frag", "arguments": '{"q":"reassembled"}'})
        emitted = _run_start(_start_command(), [neutral])
        action = next(candidate for candidate in emitted if candidate["kind"] == "external_action")
        self.assertEqual(action["arguments"], {"q": "reassembled"})

    def test_malformed_arguments_are_a_hard_error_not_an_action(self) -> None:
        """Unparseable arguments surface a ``malformed_tool_call`` error, never an external action."""
        emitted = _run_start(_start_command(), [{"type": "tool_call", "toolName": "search", "toolCallId": "call-bad", "arguments": '{"q":'}])
        self.assertNotIn("external_action", [candidate["kind"] for candidate in emitted])
        error = next(candidate for candidate in emitted if candidate.get("eventType") == "run.error")
        self.assertEqual(error["payload"], {"reason": "malformed_tool_call", "toolCallId": "call-bad"})


class ConformanceApprovalResumeTests(unittest.TestCase):
    """The approval boundary surfaces an external action; resume injects authorized deferred results."""

    def test_external_action_then_resume_feeds_deferred_results(self) -> None:
        """A tool call defers, then resume injects the authorized results and the run completes."""
        start_emitted = _run_start(_start_command(), [{"type": "tool_call", "toolName": "write", "toolCallId": "call-approve", "arguments": "{}"}])
        self.assertEqual([candidate["kind"] for candidate in start_emitted if candidate["kind"] == "external_action"], ["external_action"])

        captured: dict = {}

        def _resume_source(run_id, attempt, input_generation, deferred, _cancel, _steering):
            captured["deferred"] = deferred
            captured["inputGeneration"] = input_generation
            return iter([{"type": "output_text", "text": "done"}, {"type": "usage", "inputTokens": 1, "outputTokens": 1}])

        resume_emitted: list[dict] = []
        _execute_resume_attempt(_resume_command({"call-approve": {"ok": True}}), "instance-conf", resume_emitted.append, resume_event_source=_resume_source)
        self.assertEqual(captured["deferred"], {"call-approve": {"ok": True}})
        self.assertEqual(_event_types(resume_emitted), ["run.resumed", "run.output_text", "run.usage", "run.completed"])


class ConformanceRestartTests(unittest.TestCase):
    """Restart resumes from the subordinate local checkpoint only when coordinates agree."""

    def test_checkpoint_round_trips_for_the_agreeing_attempt(self) -> None:
        """A checkpoint written during start reads back its compiled state for a matching restart."""
        with tempfile.TemporaryDirectory() as directory:
            cipher = _ReversingCipher()
            _write_checkpoint("run-conf", 1, 9, {"compiledInput": _compiled_input()}, cipher=cipher, checkpoint_dir=directory)
            state = _read_checkpoint("run-conf", 1, 9, cipher=cipher, checkpoint_dir=directory)
            assert isinstance(state, dict)
            self.assertEqual(state["compiledInput"]["digest"], "sha256:conformance")


class ConformanceCancellationTests(unittest.TestCase):
    """Cancellation is a positive signal that suppresses every later candidate."""

    def test_cancel_mid_stream_suppresses_late_output_and_completion(self) -> None:
        """Once cancel fires mid-stream, no later candidate (or completion) is emitted."""
        cancel_event = threading.Event()

        def _source(_compiled, cancel, _steering):
            yield {"type": "output_text", "text": "before"}
            cancel.set()
            yield {"type": "output_text", "text": "after"}

        emitted: list[dict] = []
        _execute_start_attempt(_start_command(), "instance-conf", emitted.append, event_source=_source, cancel_event=cancel_event)
        self.assertEqual(_event_types(emitted), ["run.started", "run.output_text"])
        self.assertEqual(emitted[1]["payload"]["text"], "before")


class ConformanceProviderFaultTests(unittest.TestCase):
    """A provider/executor fault surfaces exactly one ``run.failed`` with zero implicit retries."""

    def test_provider_fault_surfaces_single_run_failure(self) -> None:
        """An executor exception yields started then one authoritative ``run.failed`` report."""

        def _boom(_compiled, _cancel, _steering):
            raise RuntimeError("litellm proxy unreachable")
            yield  # pragma: no cover - generator marker

        emitted: list[dict] = []
        _execute_start_attempt(_start_command(), "instance-conf", emitted.append, event_source=_boom)
        self.assertEqual(_event_types(emitted), ["run.started", "run.failed"])
        self.assertEqual(emitted[1]["payload"], {"reason": "executor_failed", "errorType": "RuntimeError"})

    def test_every_retry_path_is_pinned_to_zero(self) -> None:
        """The bounded loop performs zero implicit model/provider/tool/output retries."""
        self.assertEqual(set(_zero_retry_openai_settings().values()), {0})


class ConformanceCompactionAndBudgetTests(unittest.TestCase):
    """Compaction is excluded and budget counters normalize to safe non-negative integers."""

    def test_usage_counters_coerce_to_non_negative_integers(self) -> None:
        """Unknown or negative usage counters default to zero so budget accounting cannot go negative."""
        self.assertEqual(_normalize_event({"type": "usage", "inputTokens": None, "outputTokens": -3}), ("run.usage", {"inputTokens": 0, "outputTokens": 0}))

    def test_budget_exhausted_cancel_reason_stays_server_owned(self) -> None:
        """A server budget cancel signal stops work without creating a second terminal candidate."""
        cancel_command = {"kind": "cancel_attempt", "commandId": "cmd-cancel", "fence": 3, "assignment": {"runId": "run-conf", "attempt": 1}, "payload": {"reason": "budget_exhausted"}}
        emitted: list[dict] = []
        runtime._execute_cancel_attempt(cancel_command, "instance-conf", emitted.append, cancel_event=threading.Event())
        self.assertEqual(emitted, [])

    def test_unknown_framework_event_is_dropped_not_compacted_into_output(self) -> None:
        """An unrecognized framework event is dropped (never accumulated) and logged for observability."""
        buffer = io.StringIO()
        with contextlib.redirect_stdout(buffer):
            self.assertIsNone(_normalize_event({"type": "memory_compaction", "text": "secret-context"}))
        logged = buffer.getvalue()
        self.assertIn("framework_event_dropped", logged)
        self.assertNotIn("secret-context", logged)


class ConformanceTelemetryTests(unittest.TestCase):
    """Durable run evidence is emitted with run/attempt correlation and no credential material."""

    def test_run_evidence_carries_run_and_attempt_without_secrets(self) -> None:
        """Start emits a wide ``run_evidence`` event bound to run/attempt with no key or token."""
        buffer = io.StringIO()
        with contextlib.redirect_stdout(buffer):
            _run_start(_start_command(), [{"type": "usage", "inputTokens": 1, "outputTokens": 1}])
        evidence = [json.loads(line) for line in buffer.getvalue().splitlines() if '"event": "run_evidence"' in line]
        outcomes = {record["outcome"] for record in evidence}
        self.assertEqual(outcomes, {"started", "completed"})
        for record in evidence:
            self.assertEqual(record["runId"], "run-conf")
            self.assertEqual(record["attempt"], 1)
            self.assertNotIn("litellmKey", record)
            self.assertNotIn("token", record)

    def test_trace_seam_is_a_transparent_no_op_offline(self) -> None:
        """The OTEL span seam is a transparent no-op when the SDK is absent (the offline slice)."""
        with runtime._trace("agent_runtime.test", runId="run-conf", attempt=1) as span:
            self.assertIsNone(span)


class ConformanceLiveLiteLlmLegTests(unittest.TestCase):
    """The live-LiteLLM conformance leg — GATED on #337, skipped offline, never asserted passing here.

    This leg drives the real pinned ``pydantic-ai`` package over a LiteLLM-compatible endpoint. It runs
    only in the #337 adoption/conformance environment (both the framework installed and the endpoint
    configured); offline it is skipped and contributes no PASS. Adoption is recorded by #337, not here.
    """

    @unittest.skipUnless(
        importlib.util.find_spec("pydantic_ai") is not None and os.environ.get("OPENCRANE_RUNTIME_LIVE_CONFORMANCE") == "1",
        "live-LiteLLM conformance is the #337 adoption gate; it is skipped unless the framework is installed and OPENCRANE_RUNTIME_LIVE_CONFORMANCE=1",
    )
    def test_live_litellm_conformance_is_gated(self) -> None:  # pragma: no cover - #337 adoption env only
        """When explicitly enabled, the pinned driver symbols resolve for the live conformance run."""
        from pydantic_ai import Agent  # noqa: F401
        from pydantic_ai.models.openai import OpenAIModel  # noqa: F401
        from pydantic_ai.providers.openai import OpenAIProvider  # noqa: F401


if __name__ == "__main__":
    unittest.main()
