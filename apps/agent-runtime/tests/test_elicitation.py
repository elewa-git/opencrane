"""Focused runtime elicitation producer and resume-result conformance tests."""

import importlib.util
import threading
import unittest
from unittest import mock

from src.attempts.elicitation_results import resolve_elicitation_results
from src.attempts.execution import execute_resume_attempt, execute_start_attempt
from src.attempts.pending_elicitations import clear_pending_elicitations, record_pending_elicitation
from src.attempts.pending_tools import record_pending_tool_call
from src.attempts.resume_results import resolve_resume_results
from src.model_loop.driver import (
    _external_toolsets,
    build_zero_retry_agent,
    pydantic_ai_event_source,
    pydantic_ai_resume_source,
    translate_framework_event,
)
from src.model_loop.histories import clear_model_history
from src.model_loop.openai_generated_outputs import OpenAIGeneratedOutputCollector, OpenAIGeneratedOutputConfiguration
from src.protocol.event_projector import RuntimeEventProjector
from src.protocol.elicitation import ELICITATION_TOOL_NAME, canonical_json_digest, elicitation_proposal


def _coordinates_payload() -> dict:
    """Build the sealed compiled input used by offline attempt fixtures."""
    return {
        "promptCompilerVersion": "v1",
        "runId": "run-1",
        "attempt": 1,
        "instructions": "Ask only when required.",
        "messages": [{"role": "user", "content": "Plan it."}],
        "tools": [],
        "model": {"modelAlias": "silo-default", "maxOutputTokens": None, "generatedOutputCapabilities": []},
        "budget": {},
        "digest": "sha256:compiled",
    }


def _start_command() -> dict:
    """Build one fenced start command."""
    return {
        "kind": "start_attempt",
        "commandId": "command-start",
        "fence": 2,
        "assignment": {"runId": "run-1", "attempt": 1},
        "payload": {"snapshot": {"inputGeneration": 1}, "compiledInput": _coordinates_payload()},
    }


def _resume_command(results: list[object]) -> dict:
    """Build one fenced resume carrying server-owned elicitation results."""
    return {
        "kind": "resume_attempt",
        "commandId": "command-resume",
        "fence": 3,
        "assignment": {"runId": "run-1", "attempt": 1},
        "payload": {
            "inputGeneration": 2,
            "toolResults": [],
            "steeringRequests": [],
            "elicitationResults": results,
        },
    }


def _free_text_event() -> dict:
    """Build one valid neutral ordinary-input event."""
    return {
        "type": "elicitation_request",
        "frameworkCallId": "framework-question-1",
        "requestKey": "question-1",
        "purpose": "runtime_input",
        "body": {
            "kind": "free_text",
            "prompt": "Which region should I use?",
            "maximumLength": 500,
            "allowEmpty": False,
        },
        "expiresInSeconds": 300,
    }


class RuntimeElicitationProducerTests(unittest.TestCase):
    """Validate strict neutral-event projection into bounded proposals."""

    def test_runtime_input_candidate_pauses_without_hidden_payload(self) -> None:
        """Ordinary input produces one bound candidate and no premature run completion."""
        emitted: list[dict] = []
        execute_start_attempt(
            _start_command(),
            "runtime-instance-1",
            emitted.append,
            event_source=lambda _compiled, _cancel, _steering: iter([_free_text_event()]),
        )

        self.assertEqual([item["kind"] for item in emitted], ["event", "elicitation"])
        proposal = emitted[1]["proposal"]
        self.assertEqual(proposal["purposePayloadDigest"], canonical_json_digest(None))
        self.assertNotIn("purposePayload", proposal)
        self.assertNotIn("assignedParticipantId", emitted[1])
        self.assertFalse(any(item.get("eventType") == "run.completed" for item in emitted))

    def test_builtin_tool_is_present_without_compiled_external_tools(self) -> None:
        """The production model toolset always exposes the execution-free input request."""
        class _Definition:
            def __init__(self, **definition):
                self.definition = definition

        class _Toolset:
            def __init__(self, definitions, **_options):
                self.definitions = definitions

        toolsets = _external_toolsets(
            [],
            external_toolset_cls=_Toolset,
            tool_definition_cls=_Definition,
        )

        self.assertEqual(len(toolsets), 1)
        self.assertEqual(toolsets[0].definitions[0].definition["name"], ELICITATION_TOOL_NAME)

    def test_framework_builtin_tool_call_becomes_the_neutral_request(self) -> None:
        """The production adapter parses one complete Pydantic part into the strict neutral event."""
        class _Part:
            tool_name = ELICITATION_TOOL_NAME
            tool_call_id = "framework-question-1"

            def args_as_json_str(self):
                return '{"requestKey":"question-1","purpose":"runtime_input","body":{"kind":"free_text","prompt":"Which region should I use?","maximumLength":500,"allowEmpty":false},"expiresInSeconds":300}'

        event = type("_PartEnd", (), {"event_kind": "part_end", "part": _Part()})()

        neutral = translate_framework_event(event)

        self.assertEqual(neutral, _free_text_event())

    def test_a2ui_candidate_preserves_only_reviewed_coordinates(self) -> None:
        """A2UI input binds the exact display coordinates and their canonical digest."""
        payload = {
            "displayedActionId": "action-1",
            "sourceComponentId": "card-1",
            "actionDigest": "sha256:" + "a" * 64,
        }
        event = {
            "type": "elicitation_request",
            "frameworkCallId": "framework-a2ui-1",
            "requestKey": "a2ui-question-1",
            "purpose": "a2ui_action",
            "body": {
                "kind": "approval",
                "prompt": "Apply this change?",
                "action": "Apply the reviewed change",
                "target": "Current workspace",
                "dataUse": "Send only the displayed action",
                "consequence": "The reviewed action will run",
            },
            "purposePayload": payload,
            "expiresInSeconds": 120,
        }

        proposal = elicitation_proposal(event)

        assert proposal is not None
        self.assertEqual(proposal["purposePayload"], payload)
        self.assertEqual(proposal["purposePayloadDigest"], canonical_json_digest(payload))

    def test_malformed_or_unbounded_events_fail_closed(self) -> None:
        """Unknown fields, protected purposes, duplicate choices, and excess bounds produce no proposal."""
        hidden = {**_free_text_event(), "purposePayload": {"secret": "never"}}
        protected = {**_free_text_event(), "purpose": "personal_memory_permission"}
        unbounded = {**_free_text_event(), "expiresInSeconds": 901}
        duplicate_choices = {
            **_free_text_event(),
            "body": {
                "kind": "single_choice",
                "prompt": "Choose one",
                "choices": [{"value": "same", "label": "First"}, {"value": "same", "label": "Second"}],
            },
        }

        for event in (hidden, protected, unbounded, duplicate_choices):
            with self.subTest(event=event):
                self.assertIsNone(elicitation_proposal(event))

    def test_malformed_runtime_event_fails_without_echoing_model_content(self) -> None:
        """An invalid request becomes a bounded executor failure instead of a partial candidate."""
        emitted: list[dict] = []
        event = {**_free_text_event(), "body": {"kind": "free_text", "prompt": "Bearer secret", "maximumLength": 0, "allowEmpty": False}}

        execute_start_attempt(
            _start_command(),
            "runtime-instance-1",
            emitted.append,
            event_source=lambda _compiled, _cancel, _steering: iter([event]),
        )

        self.assertEqual(emitted[-1]["eventType"], "run.failed")
        self.assertNotIn("Bearer secret", str(emitted))

    def test_pending_elicitation_registry_is_bounded(self) -> None:
        """More than 256 concurrent correlations fail closed instead of growing process memory."""
        self.addCleanup(clear_pending_elicitations, "capacity-run", 1)
        for index in range(256):
            record_pending_elicitation("capacity-run", 1, f"question-{index}", f"call-{index}")

        with self.assertRaisesRegex(ValueError, "capacity"):
            record_pending_elicitation("capacity-run", 1, "question-overflow", "call-overflow")

    @unittest.skipUnless(importlib.util.find_spec("pydantic_ai"), "pydantic-ai is a qualification dependency")
    def test_pinned_framework_builtin_call_resumes_through_deferred_result(self) -> None:
        """Pydantic 2.13 emits and resumes the built-in call over saved history without prompt replay."""
        from pydantic_ai import Agent, DeferredToolRequests, ExternalToolset, ToolDefinition
        from pydantic_ai.models.test import TestModel

        class _InputModel(TestModel):
            def gen_tool_args(self, tool_definition):
                if tool_definition.name == ELICITATION_TOOL_NAME:
                    return {
                        "requestKey": "question-1",
                        "purpose": "runtime_input",
                        "body": {"kind": "free_text", "prompt": "Which region?", "maximumLength": 500, "allowEmpty": False},
                        "expiresInSeconds": 300,
                    }
                return super().gen_tool_args(tool_definition)

        agent = build_zero_retry_agent(
            "test-model",
            "http://unused.invalid",
            "test-key",
            "Ask only when needed.",
            [],
            agent_cls=Agent,
            model_cls=lambda _name, **_kwargs: _InputModel(call_tools=[ELICITATION_TOOL_NAME]),
            provider_cls=lambda **_kwargs: object(),
            async_openai=lambda **_kwargs: object(),
            generated_output_configuration=OpenAIGeneratedOutputConfiguration((), {}),
            external_toolset_cls=ExternalToolset,
            tool_definition_cls=ToolDefinition,
            deferred_tool_requests_cls=DeferredToolRequests,
        )
        compiled_input = {"runId": "run-1", "attempt": 1, "messages": [{"role": "user", "content": "Plan it."}]}
        cancel_event = threading.Event()

        def _components(_compiled_input):
            return (agent, OpenAIGeneratedOutputCollector(), "http://unused.invalid", "test-key")

        self.addCleanup(clear_model_history, "run-1", 1)
        self.addCleanup(clear_pending_elicitations, "run-1", 1)
        with mock.patch("src.model_loop.driver._model_loop_components", side_effect=_components):
            events = list(pydantic_ai_event_source(compiled_input, cancel_event, []))
            request = next(event for event in events if event.get("type") == "elicitation_request")
            emitted: list[dict] = []
            projector = RuntimeEventProjector(
                {"protocolVersion": "opencrane.agent-runtime/v1", "runtimeInstanceId": "runtime-instance-1", "commandId": "command-1", "runId": "run-1", "attempt": 1, "fence": 1},
                compiled_input,
                emitted.append,
                lambda *_args: None,
            )
            projector.emit(request)
            resumed = list(pydantic_ai_resume_source(
                compiled_input,
                {request["frameworkCallId"]: {"requestId": "request-1", "requestKey": "question-1", "outcome": "answered", "response": {"kind": "free_text", "text": "Nairobi"}}},
                cancel_event,
                [],
            ))

        self.assertEqual(emitted[0]["kind"], "elicitation")
        self.assertFalse(any(event.get("type") == "elicitation_request" for event in resumed))
        self.assertTrue(any(event.get("type") == "output_text" for event in resumed))


class RuntimeElicitationResumeTests(unittest.TestCase):
    """Validate exact terminal results entering the existing model resume seam."""

    def test_answered_result_reaches_the_model_seam_exactly(self) -> None:
        """Ordinary participant content keeps its request coordinates and typed response."""
        result = {
            "requestId": "request-1",
            "requestKey": "question-1",
            "outcome": "answered",
            "response": {"kind": "free_text", "text": "Use Nairobi."},
        }
        captured: dict = {}
        record_pending_elicitation("run-1", 1, "question-1", "framework-question-1")
        self.addCleanup(clear_pending_elicitations, "run-1", 1)

        def _resume_source(_compiled, model_results, _cancel, _steering):
            captured["results"] = dict(model_results)
            return iter([])

        execute_resume_attempt(
            _resume_command([result]),
            "runtime-instance-1",
            lambda _candidate: None,
            resume_event_source=_resume_source,
        )

        self.assertEqual(captured["results"], {"framework-question-1": result})

    def test_declined_expired_and_redacted_answer_are_terminal_markers(self) -> None:
        """Non-answer outcomes and protected A2UI answers carry no invented response body."""
        results = [
            {"requestId": "request-1", "requestKey": "question-1", "outcome": "declined"},
            {"requestId": "request-2", "requestKey": "question-2", "outcome": "expired"},
            {"requestId": "request-3", "requestKey": "a2ui-1", "outcome": "answered"},
        ]

        for index, result in enumerate(results):
            record_pending_elicitation("run-1", 1, result["requestKey"], f"call-{index}")
        self.addCleanup(clear_pending_elicitations, "run-1", 1)
        resolved = resolve_elicitation_results(results)

        self.assertEqual(resolved, results)
        assert resolved is not None
        self.assertNotIn("response", resolved[2])

    def test_malformed_results_fail_before_the_model_is_called(self) -> None:
        """Extra fields, response on refusal, duplicate keys, and non-JSON answers reject the whole batch."""
        invalid_batches = [
            [{"requestId": "request-1", "requestKey": "question-1", "outcome": "expired", "response": None}],
            [{"requestId": "request-1", "requestKey": "question-1", "outcome": "answered", "response": object()}],
            [
                {"requestId": "request-1", "requestKey": "question-1", "outcome": "declined"},
                {"requestId": "request-2", "requestKey": "question-1", "outcome": "expired"},
            ],
        ]
        for batch in invalid_batches:
            with self.subTest(batch=batch):
                emitted: list[dict] = []
                called = False

                def _resume_source(*_args):
                    nonlocal called
                    called = True
                    return iter([])

                execute_resume_attempt(
                    _resume_command(batch),
                    "runtime-instance-1",
                    emitted.append,
                    resume_event_source=_resume_source,
                )
                self.assertFalse(called)
                self.assertEqual(emitted[-1]["payload"], {"reason": "invalid_resume_results"})

    def test_malformed_mixed_batch_consumes_neither_result_kind(self) -> None:
        """A corrected mixed resume can reuse both correlations after malformed tool input fails."""
        record_pending_tool_call("run-1", 1, "tool-call-1", "search", {"q": "safe"})
        record_pending_elicitation("run-1", 1, "question-1", "input-call-1")
        self.addCleanup(clear_pending_elicitations, "run-1", 1)
        coordinates = {"runId": "run-1", "attempt": 1}
        elicitation = [{"requestId": "request-1", "requestKey": "question-1", "outcome": "expired"}]

        malformed = resolve_resume_results(
            coordinates,
            [{"toolInvocationId": "tool-call-1", "outcome": "failed", "failureCode": ""}],
            elicitation,
        )
        corrected = resolve_resume_results(
            coordinates,
            [{"toolInvocationId": "tool-call-1", "outcome": "failed", "failureCode": "provider_unavailable"}],
            elicitation,
        )

        self.assertIsNone(malformed)
        self.assertEqual(corrected, {
            "tool-call-1": {"error": "provider_unavailable"},
            "input-call-1": elicitation[0],
        })

    def test_framework_call_id_collision_consumes_neither_result(self) -> None:
        """Tool and elicitation terminal values cannot overwrite each other in model context."""
        record_pending_tool_call("run-1", 1, "same-call", "search", {})
        record_pending_elicitation("run-1", 1, "question-1", "same-call")
        self.addCleanup(clear_pending_elicitations, "run-1", 1)
        coordinates = {"runId": "run-1", "attempt": 1}

        result = resolve_resume_results(
            coordinates,
            [{"toolInvocationId": "same-call", "outcome": "succeeded", "result": {"ok": True}}],
            [{"requestId": "request-1", "requestKey": "question-1", "outcome": "expired"}],
        )

        self.assertIsNone(result)

if __name__ == "__main__":
    unittest.main()
