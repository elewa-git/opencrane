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

from src.tools import obot_mcp as _obot_mcp
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


def _resume_command(deferred: list, input_generation: int = 9) -> dict:
    """Build one structurally valid ``resume_attempt`` carrying authorized approval decisions.

    The REAL control-plane payload shape is an array of
    ``{approvalRequestId, decision, toolInvocationId}`` records — the server names WHICH proposed
    call was approved and never carries a result body. The default input generation matches the
    start fixture so checkpoint recovery of the compiled grants succeeds.
    """
    return {
        "kind": "resume_attempt",
        "commandId": "cmd-resume",
        "fence": 3,
        "assignment": {"runId": "run-conf", "attempt": 1},
        "payload": {"inputGeneration": input_generation, "deferredToolResults": deferred, "steeringRequests": []},
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


def _integration_compiled_input() -> dict:
    """Compiled input granting one integration tool with Obot addressing for direct invocation."""
    return {
        **_compiled_input(),
        "tools": [
            {"name": "integration:github:create_issue", "toolRevisionId": "integration:github:create_issue", "description": "", "parametersSchema": {}, "obotMcpServerId": "srv-9"},
        ],
    }


def _integration_start_command() -> dict:
    """Start command whose compiled grants carry Obot addressing."""
    return {**_start_command(), "payload": {"snapshot": {"inputGeneration": 9}, "compiledInput": _integration_compiled_input()}}


def _write_key_file(directory: str) -> str:
    """Write one attempt-scoped Obot key fixture and return its path."""
    path = os.path.join(directory, "obot-key")
    with open(path, "w", encoding="utf-8") as key_file:
        key_file.write("ok1-attempt-key\n")
    return path


class ConformanceApprovalResumeTests(unittest.TestCase):
    """The approval boundary surfaces an external action; resume executes it directly against Obot."""

    def test_approved_resume_executes_via_obot_and_reports_digest_only(self) -> None:
        """An approved decision executes against Obot, feeds the result, and reports a digest."""
        captured: dict = {}
        obot_calls: list = []
        tool_result = {"content": [{"type": "text", "text": "created"}], "isError": False}

        def _resume_source(_compiled_input, deferred, _cancel, _steering):
            captured["deferred"] = deferred
            return iter([{"type": "output_text", "text": "done"}, {"type": "usage", "inputTokens": 1, "outputTokens": 1}])

        def _invoke(base_url, key, mcp_server_id, tool_name, arguments, timeout_s):
            obot_calls.append({"base_url": base_url, "key": key, "mcp_server_id": mcp_server_id, "tool_name": tool_name, "arguments": arguments, "timeout_s": timeout_s})
            return tool_result

        resume_emitted: list[dict] = []
        cipher = _ReversingCipher()
        with tempfile.TemporaryDirectory() as directory:
            key_path = _write_key_file(directory)
            environment = {"OPENCRANE_RUNTIME_OBOT_URL": "http://obot.silo.svc.cluster.local:8080", "OPENCRANE_RUNTIME_OBOT_KEY_PATH": key_path, "OPENCRANE_RUNTIME_CHECKPOINT_DIR": directory}
            with unittest.mock.patch.dict(os.environ, environment):
                start_emitted = _run_start(_integration_start_command(), [{"type": "tool_call", "toolName": "integration:github:create_issue", "toolCallId": "call-approve", "arguments": '{"title":"x"}'}], checkpoint_cipher=cipher)
                self.assertEqual([candidate["kind"] for candidate in start_emitted if candidate["kind"] == "external_action"], ["external_action"])
                with unittest.mock.patch.object(_obot_mcp, "invoke_tool", _invoke):
                    _execute_resume_attempt(_resume_command([{"approvalRequestId": "approval-1", "decision": "approved", "toolInvocationId": "call-approve"}]), "instance-conf", resume_emitted.append, resume_event_source=_resume_source, checkpoint_cipher=cipher)

        self.assertEqual(obot_calls, [{"base_url": "http://obot.silo.svc.cluster.local:8080", "key": "ok1-attempt-key", "mcp_server_id": "srv-9", "tool_name": "create_issue", "arguments": {"title": "x"}, "timeout_s": 30.0}])
        self.assertEqual(captured["deferred"], {"call-approve": tool_result})
        completed = next(candidate for candidate in resume_emitted if candidate.get("eventType") == "tool.completed")
        self.assertEqual(completed["payload"], {"toolInvocationId": "call-approve", "resultDigest": _arguments_digest(tool_result)})
        # The digest-only receipt candidate never carries the tool content itself.
        self.assertNotIn("created", json.dumps(completed))
        self.assertEqual(_event_types(resume_emitted), ["run.resumed", "tool.completed", "run.output_text", "run.usage", "run.completed"])

    def test_denied_resume_feeds_a_refusal_without_contacting_obot(self) -> None:
        """A denied decision becomes an explicit refusal result and Obot is never reached."""
        _run_start(_integration_start_command(), [{"type": "tool_call", "toolName": "integration:github:create_issue", "toolCallId": "call-deny", "arguments": "{}"}])

        captured: dict = {}

        def _resume_source(_compiled_input, deferred, _cancel, _steering):
            captured["deferred"] = deferred
            return iter([{"type": "usage", "inputTokens": 1, "outputTokens": 1}])

        def _never_invoke(*_args, **_kwargs):
            raise AssertionError("denied approvals must not reach Obot")

        resume_emitted: list[dict] = []
        with unittest.mock.patch.object(_obot_mcp, "invoke_tool", _never_invoke):
            _execute_resume_attempt(_resume_command([{"approvalRequestId": "approval-1", "decision": "denied", "toolInvocationId": "call-deny"}]), "instance-conf", resume_emitted.append, resume_event_source=_resume_source)

        self.assertEqual(captured["deferred"], {"call-deny": {"approved": False, "reason": "approval_denied"}})
        self.assertNotIn("tool.completed", _event_types(resume_emitted))

    def test_approved_resume_without_obot_configuration_fails_typed(self) -> None:
        """Without the Obot mount an approved integration tool fails with a typed loop error."""
        _run_start(_integration_start_command(), [{"type": "tool_call", "toolName": "integration:github:create_issue", "toolCallId": "call-unconfigured", "arguments": "{}"}])

        captured: dict = {}

        def _resume_source(_compiled_input, deferred, _cancel, _steering):
            captured["deferred"] = deferred
            return iter([{"type": "usage", "inputTokens": 1, "outputTokens": 1}])

        environment = {key: value for key, value in os.environ.items() if not key.startswith("OPENCRANE_RUNTIME_OBOT_")}
        resume_emitted: list[dict] = []
        with unittest.mock.patch.dict(os.environ, environment, clear=True):
            _execute_resume_attempt(_resume_command([{"approvalRequestId": "approval-1", "decision": "approved", "toolInvocationId": "call-unconfigured"}]), "instance-conf", resume_emitted.append, resume_event_source=_resume_source)

        self.assertEqual(captured["deferred"], {"call-unconfigured": {"error": "obot_unavailable"}})
        error = next(candidate for candidate in resume_emitted if candidate.get("eventType") == "run.error")
        self.assertEqual(error["payload"], {"reason": "obot_invocation_failed", "toolInvocationId": "call-unconfigured"})

    def test_unknown_invocation_and_obot_failure_fail_closed(self) -> None:
        """An unmapped approval or an Obot transport failure feeds typed errors, never fabrication."""
        captured: dict = {}

        def _resume_source(_compiled_input, deferred, _cancel, _steering):
            captured["deferred"] = deferred
            return iter([{"type": "usage", "inputTokens": 1, "outputTokens": 1}])

        def _broken_invoke(*_args, **_kwargs):
            raise RuntimeError("proxy body must never surface")

        resume_emitted: list[dict] = []
        cipher = _ReversingCipher()
        with tempfile.TemporaryDirectory() as directory:
            key_path = _write_key_file(directory)
            environment = {"OPENCRANE_RUNTIME_OBOT_URL": "http://obot.silo.svc.cluster.local:8080", "OPENCRANE_RUNTIME_OBOT_KEY_PATH": key_path, "OPENCRANE_RUNTIME_CHECKPOINT_DIR": directory}
            with unittest.mock.patch.dict(os.environ, environment):
                _run_start(_integration_start_command(), [{"type": "tool_call", "toolName": "integration:github:create_issue", "toolCallId": "call-fails", "arguments": "{}"}], checkpoint_cipher=cipher)
                with unittest.mock.patch.object(_obot_mcp, "invoke_tool", _broken_invoke):
                    _execute_resume_attempt(_resume_command([
                        {"approvalRequestId": "approval-1", "decision": "approved", "toolInvocationId": "call-fails"},
                        {"approvalRequestId": "approval-2", "decision": "approved", "toolInvocationId": "call-never-proposed"},
                    ]), "instance-conf", resume_emitted.append, resume_event_source=_resume_source, checkpoint_cipher=cipher)

        self.assertEqual(captured["deferred"], {
            "call-fails": {"error": "obot_invocation_failed", "errorType": "RuntimeError"},
            "call-never-proposed": {"error": "unknown_tool_invocation"},
        })
        reasons = [candidate["payload"].get("reason") for candidate in resume_emitted if candidate.get("eventType") == "run.error"]
        self.assertEqual(sorted(reasons), ["obot_invocation_failed", "unknown_tool_invocation"])
        self.assertNotIn("proxy body must never surface", json.dumps(resume_emitted))


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

    def test_trace_seam_is_a_transparent_no_op_offline(self) -> None:
        """The OTEL span seam is a transparent no-op when the SDK is absent (the offline slice)."""
        with _trace("agent_runtime.test", runId="run-conf", attempt=1) as span:
            self.assertIsNone(span)


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
        from pydantic_ai.models.openai import OpenAIModel  # noqa: F401
        from pydantic_ai.providers.openai import OpenAIProvider  # noqa: F401


if __name__ == "__main__":
    unittest.main()
