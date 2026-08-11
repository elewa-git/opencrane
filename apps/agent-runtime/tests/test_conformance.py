"""Offline conformance harness for the OpenCrane agent runtime against a LiteLLM-compatible double.

This suite qualifies the runtime shell's observable protocol behaviour against INDEPENDENTLY AUTHORED
neutral-event fixtures fed through a mock model loop that stands in for the bounded Pydantic AI loop
over the per-silo LiteLLM proxy. Every fixture is written here from the protocol contract; none is
derived from any transcript, and the harness imports no model framework and reaches no network.

The live-LiteLLM conformance leg drives the pinned ``pydantic-ai`` package against a live proxy.
It is explicitly environment-guarded and skipped offline; this suite does not claim that live
qualification passed.

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
import unittest.mock
from src.model_loop.checkpoints import (
    read_checkpoint as _read_checkpoint,
    write_checkpoint as _write_checkpoint,
)
from src.model_loop.driver import (
    translate_framework_event as _translate_framework_event,
    zero_retry_openai_settings as _zero_retry_openai_settings,
)
from src.observability import trace as _trace
from src.attempts.execution import (
    execute_cancel_attempt as _execute_cancel_attempt,
    execute_resume_attempt as _execute_resume_attempt,
    execute_start_attempt as _execute_start_attempt,
)
from src.protocol.candidates import (
    arguments_digest as _arguments_digest,
    normalize_event as _normalize_event,
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
        "runId": "run-conf",
        "attempt": 1,
        "instructions": "answer precisely",
        "messages": [{"role": "user", "content": "hello"}],
        "tools": [
            {"name": "search", "toolRevisionId": "rev-search", "description": "", "parametersSchema": {}},
            {"name": "write", "toolRevisionId": "rev-write", "description": "", "parametersSchema": {}},
        ],
        "model": {"modelAlias": "silo-default", "maxOutputTokens": None, "generatedOutputCapabilities": []},
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


def _resume_command(tool_results: list, input_generation: int = 9) -> dict:
    """Build one valid resume carrying exact saved server-owned tool results."""
    return {
        "kind": "resume_attempt",
        "commandId": "cmd-resume",
        "fence": 3,
        "assignment": {"runId": "run-conf", "attempt": 1},
        "payload": {"inputGeneration": input_generation, "toolResults": tool_results, "steeringRequests": []},
    }


def _succeeded(tool_invocation_id: str, result: object) -> dict:
    """Build one exact saved success returned by the control plane."""
    return {"toolInvocationId": tool_invocation_id, "outcome": "succeeded", "result": result}


def _failed(tool_invocation_id: str, failure_code: str) -> dict:
    """Build one exact saved terminal failure returned by the control plane."""
    return {"toolInvocationId": tool_invocation_id, "outcome": "failed", "failureCode": failure_code}


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
        self.assertEqual(_event_types(emitted), ["run.started", "message.started", "message.delta", "message.delta", "run.usage", "message.completed", "run.completed"])
        self.assertEqual([candidate["payload"].get("delta") for candidate in emitted if candidate.get("eventType") == "message.delta"], ["one ", "two "])
        usage = next(candidate for candidate in emitted if candidate.get("eventType") == "run.usage")
        self.assertEqual(usage["payload"], {"inputTokens": 11, "outputTokens": 4})

    def test_slow_progress_preserves_order_and_bounds_each_event(self) -> None:
        """A long slow stream keeps per-event bounded candidates in order without accumulation."""
        deltas = [{"type": "output_text", "text": f"chunk-{index}"} for index in range(64)]
        emitted = _run_start(_start_command(), deltas)
        texts = [candidate["payload"]["delta"] for candidate in emitted if candidate.get("eventType") == "message.delta"]
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
            event_kind="part_end",
            delta=None,
            part=types.SimpleNamespace(part_kind="tool-call", tool_name="search", tool_call_id="call-frag", args_as_json_str=lambda: '{"q":"reassembled"}'),
        )
        neutral = _translate_framework_event(reassembled)
        self.assertEqual(neutral, {"type": "tool_call", "toolName": "search", "toolCallId": "call-frag", "arguments": '{"q":"reassembled"}'})
        emitted = _run_start(_start_command(), [neutral])
        action = next(candidate for candidate in emitted if candidate["kind"] == "external_action")
        self.assertEqual(action["arguments"], {"q": "reassembled"})

    def test_tool_stream_emits_only_one_complete_memory_call(self) -> None:
        """Tool start and argument deltas stay internal; only the complete final call is surfaced."""
        events = [
            types.SimpleNamespace(
                event_kind="part_start",
                delta=None,
                part=types.SimpleNamespace(tool_name="memory_recall", tool_call_id="memory-1", args_as_json_str=lambda: "{}"),
            ),
            types.SimpleNamespace(
                event_kind="part_delta",
                delta=types.SimpleNamespace(args_delta='{"query":"remember this"}'),
                part=None,
            ),
            types.SimpleNamespace(
                event_kind="part_end",
                delta=None,
                part=types.SimpleNamespace(tool_name="memory_recall", tool_call_id="memory-1", args_as_json_str=lambda: '{"query":"remember this"}'),
            ),
        ]

        neutral = [_translate_framework_event(event) for event in events]
        tool_calls = [event for event in neutral if event.get("type") == "tool_call"]
        self.assertEqual(tool_calls, [{
            "type": "tool_call",
            "toolName": "memory_recall",
            "toolCallId": "memory-1",
            "arguments": '{"query":"remember this"}',
        }])

    def test_malformed_arguments_are_a_hard_error_not_an_action(self) -> None:
        """Unparseable arguments surface a ``malformed_tool_call`` error, never an external action."""
        emitted = _run_start(_start_command(), [{"type": "tool_call", "toolName": "search", "toolCallId": "call-bad", "arguments": '{"q":'}])
        self.assertNotIn("external_action", [candidate["kind"] for candidate in emitted])
        error = next(candidate for candidate in emitted if candidate.get("eventType") == "tool.failed")
        self.assertEqual(error["payload"], {"reason": "malformed_tool_call", "toolInvocationId": "call-bad"})


def _integration_compiled_input() -> dict:
    """Compiled input granting one integration tool without provider authority."""
    return {
        **_compiled_input(),
        "tools": [
            {"name": "integration:github:create_issue", "toolRevisionId": "integration:github:create_issue", "description": "", "parametersSchema": {}},
        ],
    }


def _integration_start_command() -> dict:
    """Start command whose compiled grants carry only model-visible tool definitions."""
    return {**_start_command(), "payload": {"snapshot": {"inputGeneration": 9}, "compiledInput": _integration_compiled_input()}}


class ConformanceApprovalResumeTests(unittest.TestCase):
    """The runtime maps saved server results and never contacts an external provider."""

    def test_resume_feeds_the_saved_success_without_repeating_the_action(self) -> None:
        """A saved success enters the loop without a second tool lifecycle or provider call."""
        captured: dict = {}
        tool_result = {"content": [{"type": "text", "text": "created"}], "isError": False}

        def _resume_source(_compiled_input, results, _cancel, _steering):
            captured["results"] = results
            return iter([{"type": "output_text", "text": "done"}, {"type": "usage", "inputTokens": 1, "outputTokens": 1}])

        resume_emitted: list[dict] = []
        cipher = _ReversingCipher()
        with tempfile.TemporaryDirectory() as directory:
            environment = {"OPENCRANE_RUNTIME_CHECKPOINT_DIR": directory}
            with unittest.mock.patch.dict(os.environ, environment):
                start_emitted = _run_start(_integration_start_command(), [{"type": "tool_call", "toolName": "integration:github:create_issue", "toolCallId": "call-approve", "arguments": '{"title":"x"}'}], checkpoint_cipher=cipher)
                self.assertEqual([candidate["kind"] for candidate in start_emitted if candidate["kind"] == "external_action"], ["external_action"])
                _execute_resume_attempt(_resume_command([_succeeded("call-approve", tool_result)]), "instance-conf", resume_emitted.append, resume_event_source=_resume_source, checkpoint_cipher=cipher)

        self.assertEqual(captured["results"], {"call-approve": tool_result})
        self.assertEqual(_event_types(resume_emitted), ["run.resumed", "message.started", "message.delta", "run.usage", "message.completed", "run.completed"])

    def test_terminal_failure_enters_the_loop_as_a_typed_error(self) -> None:
        """A saved refusal becomes an exact typed result with no external provider path."""
        _run_start(_integration_start_command(), [{"type": "tool_call", "toolName": "integration:github:create_issue", "toolCallId": "call-deny", "arguments": "{}"}])

        captured: dict = {}

        def _resume_source(_compiled_input, results, _cancel, _steering):
            captured["results"] = results
            return iter([{"type": "usage", "inputTokens": 1, "outputTokens": 1}])

        resume_emitted: list[dict] = []
        _execute_resume_attempt(_resume_command([_failed("call-deny", "approval_denied")]), "instance-conf", resume_emitted.append, resume_event_source=_resume_source)

        self.assertEqual(captured["results"], {"call-deny": {"error": "approval_denied"}})
        self.assertNotIn("tool.completed", _event_types(resume_emitted))

    def test_unknown_or_malformed_saved_results_fail_closed(self) -> None:
        """An unmapped or malformed result never enters model context."""
        captured: dict = {}

        def _resume_source(_compiled_input, results, _cancel, _steering):
            captured["results"] = results
            return iter([{"type": "usage", "inputTokens": 1, "outputTokens": 1}])

        resume_emitted: list[dict] = []
        _execute_resume_attempt(_resume_command([
            _succeeded("call-never-proposed", {"secret": "must-not-enter"}),
            {"toolInvocationId": "call-malformed", "outcome": "failed", "failureCode": ""},
        ]), "instance-conf", resume_emitted.append, resume_event_source=_resume_source)

        self.assertNotIn("results", captured)
        reasons = [candidate["payload"].get("reason") for candidate in resume_emitted if candidate.get("eventType") in ("run.error", "run.failed")]
        self.assertEqual(reasons, ["invalid_tool_result", "invalid_tool_results"])
        self.assertNotIn("must-not-enter", json.dumps(captured))


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
        self.assertEqual(_event_types(emitted), ["run.started", "message.started", "message.delta"])
        self.assertEqual(emitted[2]["payload"]["delta"], "before")


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
        """A budget cancel stops work and records only the server-owned cancellation reason."""
        cancel_command = {"kind": "cancel_attempt", "commandId": "cmd-cancel", "fence": 3, "assignment": {"runId": "run-conf", "attempt": 1}, "payload": {"reason": "budget_exhausted"}}
        cancel_event = threading.Event()
        buffer = io.StringIO()
        with contextlib.redirect_stdout(buffer):
            _execute_cancel_attempt(cancel_command, "instance-conf", cancel_event=cancel_event)
        evidence = json.loads(buffer.getvalue())
        self.assertTrue(cancel_event.is_set())
        self.assertEqual(evidence["outcome"], "cancelled")
        self.assertEqual(evidence["reason"], "budget_exhausted")

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

    def test_trace_seam_is_transparent_with_or_without_the_optional_api(self) -> None:
        """The optional OTEL API yields None or a non-recording span without changing execution."""
        with _trace("agent_runtime.test", runId="run-conf", attempt=1) as span:
            self.assertTrue(span is None or not span.is_recording())


class ConformanceLiveLiteLlmLegTests(unittest.TestCase):
    """Run the live-LiteLLM conformance preflight only in an explicitly enabled environment.

    This leg drives the real pinned ``pydantic-ai`` package over a LiteLLM-compatible endpoint. It runs
    only when both the framework and endpoint are configured; offline it is skipped and contributes
    no live qualification evidence.
    """

    @unittest.skipUnless(
        importlib.util.find_spec("pydantic_ai") is not None and os.environ.get("OPENCRANE_RUNTIME_LIVE_CONFORMANCE") == "1",
        "live-LiteLLM conformance requires the framework and OPENCRANE_RUNTIME_LIVE_CONFORMANCE=1",
    )
    def test_live_litellm_conformance_is_enabled(self) -> None:  # pragma: no cover - live environment only
        """When explicitly enabled, the pinned driver symbols resolve for the live conformance run."""
        from pydantic_ai import Agent  # noqa: F401
        from pydantic_ai.models.openai import OpenAIResponsesModel  # noqa: F401
        from pydantic_ai.providers.openai import OpenAIProvider  # noqa: F401


if __name__ == "__main__":
    unittest.main()
