"""Focused behavioral tests for the runtime shell, its bootstrap exchange, and the model executor.

The executor is exercised offline against recorded neutral-event fixtures fed through the same
normalizer the live Pydantic AI driver feeds. The broader offline conformance harness and
fault-injection matrix live in ``test_conformance.py`` and ``test_fault_matrix.py``. Live LiteLLM
qualification is a separate environment-guarded suite; these tests import no framework package and
reach no network.
"""

import contextlib
import importlib.util
import io
import json
import os
import tempfile
import threading
import unittest
from unittest import mock
from urllib.error import HTTPError, URLError

from src.bootstrap.exchange import BootstrapDeniedError
from src.bootstrap.proof import load_or_create_proof_key as _load_or_create_proof_key, rfc7638_thumbprint as _rfc7638_thumbprint
from src.constants import CHECKPOINT_FILENAME
from src.model_loop.checkpoints import (
    checkpoint_path as _checkpoint_path,
    read_checkpoint as _read_checkpoint,
    write_checkpoint as _write_checkpoint,
)
from src.model_loop.driver import (
    absorb_steering as _absorb_steering,
    build_zero_retry_agent as _build_zero_retry_agent,
    pydantic_ai_event_source as _pydantic_ai_event_source,
    pydantic_ai_resume_source as _pydantic_ai_resume_source,
    zero_retry_openai_settings as _zero_retry_openai_settings,
)
from src.model_loop.openai_generated_outputs import OpenAIGeneratedOutputConfiguration as _OpenAIGeneratedOutputConfiguration
from src.model_loop.openai_generated_outputs import OpenAIGeneratedOutputCollector as _OpenAIGeneratedOutputCollector
from src.model_loop.histories import (
    clear_model_history as _clear_model_history,
    load_model_history as _load_model_history,
    store_model_history as _store_model_history,
)
from src.attempts.execution import (
    execute_cancel_attempt as _execute_cancel_attempt,
    execute_resume_attempt as _execute_resume_attempt,
    execute_start_attempt as _execute_start_attempt,
)
from src.attempts.terminal import TerminalGate as _TerminalGate
from src.protocol.candidates import (
    arguments_digest as _arguments_digest,
    candidate as _candidate,
    command_coordinates as _command_coordinates,
    normalize_event as _normalize_event,
    tool_call_candidate as _tool_call_candidate,
)
from src.protocol.wait_reasons import RuntimeWaitReason as _RuntimeWaitReason
from src.runtime import retry_delay as _retry_delay, run_forever
from src.transport.http import post_candidate as _post_candidate
from src.transport.stream import (
    _AttemptWorkerRegistry,
    iter_commands as _iter_commands,
)


def _compiled_input(run_id: str = "r1", attempt: int = 1) -> dict:
    """Build a compiled input whose grant set fixes the ``alpha`` and ``zulu`` tool revisions."""
    return {
        "promptCompilerVersion": "v1",
        "runId": run_id,
        "attempt": attempt,
        "instructions": "be careful",
        "messages": [{"role": "user", "content": "hi"}],
        "tools": [
            {"name": "alpha", "toolRevisionId": "rev-alpha", "description": "", "parametersSchema": {}},
            {"name": "zulu", "toolRevisionId": "rev-zulu", "description": "", "parametersSchema": {}},
        ],
        "model": {"modelAlias": "silo-default", "maxOutputTokens": None, "generatedOutputCapabilities": []},
        "budget": {},
        "digest": "sha256:x",
    }


def _start_command(attempt: int = 1) -> dict:
    """Build one structurally valid ``start_attempt`` command carrying a compiled input."""
    return {
        "kind": "start_attempt",
        "commandId": "c1",
        "fence": 2,
        "assignment": {"runId": "r1", "attempt": attempt},
        "payload": {"snapshot": {"inputGeneration": 4}, "compiledInput": _compiled_input(attempt=attempt)},
    }


def _resume_command(attempt: int = 1) -> dict:
    """Build one structurally valid ``resume_attempt`` command carrying saved tool results."""
    return {
        "kind": "resume_attempt",
        "commandId": "c2",
        "fence": 2,
        "assignment": {"runId": "r1", "attempt": attempt},
        "payload": {"inputGeneration": 7, "toolResults": [], "steeringRequests": [], "elicitationResults": []},
    }


def _cancel_command(attempt: int = 1) -> dict:
    """Build one structurally valid ``cancel_attempt`` command carrying a server-chosen reason."""
    return {
        "kind": "cancel_attempt",
        "commandId": "c3",
        "fence": 2,
        "assignment": {"runId": "r1", "attempt": attempt},
        "payload": {"reason": "budget_exhausted"},
    }


class _ReversingCipher:
    """A reversible in-test cipher seam so checkpoints round-trip without the ``cryptography`` package."""

    def encrypt(self, data: bytes) -> bytes:
        return b"v:" + data[::-1]

    def decrypt(self, token: bytes) -> bytes:
        if not token.startswith(b"v:"):
            raise ValueError("bad token")
        return token[len(b"v:"):][::-1]


class RuntimeRetryDelayTests(unittest.TestCase):
    """Validate the shell's bounded reconnect behavior."""

    def test_retry_delay_is_bounded(self) -> None:
        """A permanently unavailable controller cannot make retries grow without bound."""
        self.assertLessEqual(_retry_delay(100), 31.0)

    def test_candidate_transport_never_retries_an_ambiguous_failure(self) -> None:
        """One failed POST is surfaced immediately because repeating an action may duplicate it."""
        candidate = {"candidateId": "candidate-once", "runId": "r1", "attempt": 1, "kind": "external_action"}
        sent: list[dict] = []

        def _post(_url: str, _token: str, body: dict, _timeout: float) -> int:
            sent.append(body)
            raise HTTPError("https://control.example/candidates", 503, "ambiguous", {}, io.BytesIO(b"{}"))

        with self.assertRaises(HTTPError):
            _post_candidate("https://control.example", "projected-token", candidate, _post)

        self.assertEqual(sent, [candidate])


class RuntimeThumbprintTests(unittest.TestCase):
    """Validate the RFC 7638 thumbprint matches the canonical EC member order."""

    def test_thumbprint_is_deterministic_unpadded_base64url(self) -> None:
        """The digest is a stable 43-char unpadded base64url SHA-256 that changes with the key."""
        first = _rfc7638_thumbprint("x-coordinate", "y-coordinate")
        self.assertEqual(len(first), 43)
        self.assertNotIn("=", first)
        self.assertEqual(first, _rfc7638_thumbprint("x-coordinate", "y-coordinate"))
        self.assertNotEqual(first, _rfc7638_thumbprint("x-coordinate", "other-coordinate"))

    def test_public_proof_evidence_survives_a_container_restart(self) -> None:
        """The same Pod reloads its first public thumbprint without storing a model or private key."""
        public_jwk = {"kty": "EC", "crv": "P-256", "x": "x-coordinate", "y": "y-coordinate"}
        evidence = {"publicJwk": public_jwk, "thumbprint": _rfc7638_thumbprint("x-coordinate", "y-coordinate")}
        with tempfile.TemporaryDirectory() as directory:
            path = os.path.join(directory, "proof-evidence.json")
            with mock.patch("src.bootstrap.proof.generate_proof_key", return_value=evidence) as generate:
                first = _load_or_create_proof_key(path)
                second = _load_or_create_proof_key(path)

            self.assertEqual(first, second)
            generate.assert_called_once()
            with open(path, "r", encoding="utf-8") as evidence_file:
                stored = json.load(evidence_file)
            self.assertEqual(stored, evidence)
            self.assertNotIn("private", str(stored).lower())
            self.assertNotIn("model", str(stored).lower())

    def test_changed_saved_public_evidence_fails_closed(self) -> None:
        """A damaged restart file cannot silently create a different proof for an already claimed Pod."""
        with tempfile.TemporaryDirectory() as directory:
            path = os.path.join(directory, "proof-evidence.json")
            with open(path, "w", encoding="utf-8") as evidence_file:
                json.dump({"publicJwk": {"kty": "EC", "crv": "P-256", "x": "x-coordinate", "y": "y-coordinate"}, "thumbprint": "changed"}, evidence_file)

            with self.assertRaisesRegex(RuntimeError, "thumbprint does not match"):
                _load_or_create_proof_key(path)


class RuntimeCommandFramingTests(unittest.TestCase):
    """Validate SSE command parsing."""

    def test_iter_commands_parses_only_command_events(self) -> None:
        """Only ``command`` events yield a parsed body; heartbeats are ignored."""
        lines = [
            b"event: command\n",
            b'data: {"kind":"start_attempt","commandId":"c1","fence":1,"assignment":{"runId":"r1","attempt":1}}\n',
            b"\n",
            b"event: heartbeat\n",
            b'data: {"protocolVersion":"opencrane.agent-runtime/v1"}\n',
            b"\n",
        ]
        commands = list(_iter_commands(iter(lines), threading.Event()))
        self.assertEqual(len(commands), 1)
        self.assertEqual(commands[0]["commandId"], "c1")

    def test_iter_commands_stops_when_cancelled(self) -> None:
        """A set cancellation flag bounds command reading after stream loss."""
        cancelled = threading.Event()
        cancelled.set()
        self.assertEqual(list(_iter_commands(iter([b"event: command\n"]), cancelled)), [])

    def test_new_worker_supersedes_prior_and_stream_loss_cancels_every_worker(self) -> None:
        """Overlapping commands cannot leave an older worker alive after a replacement or EOF."""
        workers = _AttemptWorkerRegistry()
        first = workers.activate()
        second = workers.activate()

        self.assertTrue(first.is_set())
        self.assertFalse(second.is_set())
        workers.cancel_all()
        self.assertTrue(second.is_set())


class RuntimeNormalizerTests(unittest.TestCase):
    """Validate the neutral-event normalizer that keeps framework types out of candidates."""

    def test_output_text_event(self) -> None:
        """A text delta becomes a bounded canonical message payload."""
        self.assertEqual(_normalize_event({"type": "output_text", "text": "hello"}, "message-1"), ("message.delta", {"messageId": "message-1", "delta": "hello"}))

    def test_error_event_omits_provider_detail(self) -> None:
        """A framework error exposes only a bounded type, never its provider message."""
        normalized = _normalize_event({"type": "error", "message": "Bearer secret-value", "errorType": "AuthenticationError"})
        self.assertEqual(normalized, ("run.error", {"reason": "model_loop_error", "errorType": "AuthenticationError"}))
        self.assertNotIn("secret-value", str(normalized))

    def test_complete_a2ui_envelope_passes_through_without_shape_invention(self) -> None:
        """A neutral adapter may forward a complete envelope, while an absent envelope is dropped."""
        envelope = {"version": "v0.9", "runId": "r1", "conversationId": "conversation-1", "surfaceId": "main", "components": []}
        self.assertEqual(_normalize_event({"type": "a2ui_surface_updated", "payload": envelope}), ("a2ui.surface.updated", {"a2ui": envelope}))
        self.assertIsNone(_normalize_event({"type": "a2ui_surface_updated"}))

    def test_usage_event_coerces_counters(self) -> None:
        """Usage counters normalize to non-negative integers, defaulting unknown values to zero."""
        self.assertEqual(_normalize_event({"type": "usage", "inputTokens": 12, "outputTokens": None}), ("run.usage", {"inputTokens": 12, "outputTokens": 0}))

    def test_unknown_event_is_dropped(self) -> None:
        """An unrecognized event yields no candidate but is logged for observability."""
        buffer = io.StringIO()
        with contextlib.redirect_stdout(buffer):
            self.assertIsNone(_normalize_event({"type": "mystery"}))
        logged = buffer.getvalue()
        self.assertIn("framework_event_dropped", logged)
        self.assertIn("mystery", logged)


class RuntimeToolCallCandidateTests(unittest.TestCase):
    """Validate that a model tool call becomes an external-action candidate or a hard error."""

    def _coordinates(self) -> dict:
        coordinates = _command_coordinates(_start_command(), "instance-1")
        assert coordinates is not None
        return coordinates

    def test_granted_tool_call_becomes_external_action(self) -> None:
        """A granted tool resolves its revision from the compiled tools and yields an external action."""
        event = {"type": "tool_call", "toolName": "alpha", "toolCallId": "t1", "arguments": '{"q":"a"}'}
        candidate = _tool_call_candidate(self._coordinates(), _compiled_input(), event)
        self.assertEqual(candidate["kind"], "external_action")
        self.assertEqual(candidate["toolRevisionId"], "rev-alpha")
        self.assertEqual(candidate["toolInvocationId"], "t1")
        self.assertEqual(candidate["arguments"], {"q": "a"})
        self.assertEqual(candidate["argumentsDigest"], _arguments_digest({"q": "a"}))
        self.assertTrue(candidate["argumentsDigest"].startswith("sha256:"))
        self.assertNotIn("eventType", candidate)

    def test_arguments_digest_is_deterministic_and_key_order_independent(self) -> None:
        """The digest is a stable ``sha256:<hex>`` independent of argument key order."""
        self.assertEqual(_arguments_digest({"a": 1, "b": 2}), _arguments_digest({"b": 2, "a": 1}))
        self.assertNotEqual(_arguments_digest({"a": 1}), _arguments_digest({"a": 2}))

    def test_ungranted_tool_call_is_unknown_tool_error(self) -> None:
        """A tool outside the compiled grant set is a hard ``unknown_tool`` error, never an action."""
        event = {"type": "tool_call", "toolName": "ghost", "toolCallId": "t9", "arguments": "{}"}
        candidate = _tool_call_candidate(self._coordinates(), _compiled_input(), event)
        self.assertEqual(candidate["kind"], "event")
        self.assertEqual(candidate["eventType"], "tool.failed")
        self.assertEqual(candidate["payload"], {"reason": "unknown_tool", "toolInvocationId": "t9"})

    def test_malformed_arguments_become_error(self) -> None:
        """Unparseable tool arguments become ``tool.failed`` rather than an external action."""
        event = {"type": "tool_call", "toolName": "alpha", "toolCallId": "t1", "arguments": '{"q":'}
        candidate = _tool_call_candidate(self._coordinates(), _compiled_input(), event)
        self.assertEqual(candidate["eventType"], "tool.failed")
        self.assertEqual(candidate["payload"], {"reason": "malformed_tool_call", "toolInvocationId": "t1"})

    def test_missing_tool_fields_become_error(self) -> None:
        """A tool call missing its name or id is malformed and never an external action."""
        candidate = _tool_call_candidate(self._coordinates(), _compiled_input(), {"type": "tool_call", "toolName": "alpha"})
        self.assertEqual(candidate["payload"], {"reason": "malformed_tool_call"})


class RuntimeSteeringTests(unittest.TestCase):
    """Validate steering is absorbed only at the pre-model-request boundary."""

    def test_steering_absorbed_only_at_the_next_boundary(self) -> None:
        """Buffered steering drains at the boundary; steering arriving after waits for the next one."""
        buffer: list[str] = ["do X"]
        self.assertEqual(_absorb_steering(buffer), ["do X"])
        self.assertEqual(buffer, [])
        # Steering that arrives after the boundary is buffered and absorbed only at the NEXT boundary.
        buffer.append("do Y")
        self.assertEqual(_absorb_steering(buffer), ["do Y"])
        self.assertEqual(_absorb_steering(buffer), [])


class RuntimeCheckpointTests(unittest.TestCase):
    """Validate the encrypted, version-tagged, replaceable, subordinate local checkpoint."""

    def test_checkpoint_round_trips_encrypted_and_version_tagged(self) -> None:
        """A written checkpoint is stored encrypted and reads back its state when coordinates agree."""
        with tempfile.TemporaryDirectory() as directory:
            cipher = _ReversingCipher()
            path = _write_checkpoint("r1", 1, 3, {"compiledInput": {"tools": []}}, cipher=cipher, checkpoint_dir=directory)
            with open(path, "rb") as handle:
                raw = handle.read()
            # The payload is ciphered on disk, not stored as readable plaintext JSON.
            self.assertNotIn(b"compiledInput", raw)
            self.assertNotIn(b"checkpointVersion", raw)
            state = _read_checkpoint("r1", 1, 3, cipher=cipher, checkpoint_dir=directory)
            self.assertEqual(state, {"compiledInput": {"tools": []}})

    def test_checkpoint_is_discarded_when_coordinates_disagree(self) -> None:
        """A checkpoint that disagrees with the server run/attempt/inputGeneration is discarded."""
        with tempfile.TemporaryDirectory() as directory:
            cipher = _ReversingCipher()
            _write_checkpoint("r1", 1, 3, {"compiledInput": {}}, cipher=cipher, checkpoint_dir=directory)
            self.assertIsNone(_read_checkpoint("r1", 1, 4, cipher=cipher, checkpoint_dir=directory))
            self.assertIsNone(_read_checkpoint("other", 1, 3, cipher=cipher, checkpoint_dir=directory))
            self.assertIsNone(_read_checkpoint("r1", 2, 3, cipher=cipher, checkpoint_dir=directory))

    def test_a_wrong_version_checkpoint_is_discarded(self) -> None:
        """A checkpoint tagged with an unknown version is discarded rather than trusted."""
        with tempfile.TemporaryDirectory() as directory:
            cipher = _ReversingCipher()
            path = _checkpoint_path(directory)
            forged = cipher.encrypt(json.dumps({"checkpointVersion": 999, "runId": "r1", "attempt": 1, "inputGeneration": 3, "state": {}}, sort_keys=True, separators=(",", ":")).encode("utf-8"))
            with open(path, "wb") as handle:
                handle.write(forged)
            self.assertIsNone(_read_checkpoint("r1", 1, 3, cipher=cipher, checkpoint_dir=directory))

    def test_second_write_atomically_replaces_the_first(self) -> None:
        """Writing a new checkpoint replaces the prior one at the same fixed path."""
        with tempfile.TemporaryDirectory() as directory:
            cipher = _ReversingCipher()
            _write_checkpoint("r1", 1, 3, {"compiledInput": {"tag": "first"}}, cipher=cipher, checkpoint_dir=directory)
            _write_checkpoint("r1", 1, 3, {"compiledInput": {"tag": "second"}}, cipher=cipher, checkpoint_dir=directory)
            # Only the single fixed checkpoint file survives, holding the latest state.
            self.assertEqual(os.listdir(directory), [CHECKPOINT_FILENAME])
            self.assertEqual(_read_checkpoint("r1", 1, 3, cipher=cipher, checkpoint_dir=directory), {"compiledInput": {"tag": "second"}})

    def test_checkpoint_directory_environment_override_is_honoured(self) -> None:
        """The documented checkpoint-directory setting remains part of the process contract."""
        with tempfile.TemporaryDirectory() as directory:
            os.environ["OPENCRANE_RUNTIME_CHECKPOINT_DIR"] = directory
            try:
                self.assertEqual(_checkpoint_path(None), os.path.join(directory, CHECKPOINT_FILENAME))
            finally:
                os.environ.pop("OPENCRANE_RUNTIME_CHECKPOINT_DIR", None)


class RuntimeZeroRetryTests(unittest.TestCase):
    """Prove the executor's model configuration performs zero implicit retries."""

    def test_every_retry_path_is_zero(self) -> None:
        """Model-request, provider-HTTP, tool-validation, and output-validation retries are all zero."""
        settings = _zero_retry_openai_settings()
        self.assertEqual(set(settings.values()), {0})
        self.assertEqual(settings["model_request_retries"], 0)
        self.assertEqual(settings["provider_http_retries"], 0)
        self.assertEqual(settings["tool_validation_retries"], 0)
        self.assertEqual(settings["output_validation_retries"], 0)

    def test_zero_retry_settings_reach_provider_and_agent(self) -> None:
        """The zero-retry values are actually passed to the OpenAI client and Agent, not merely returned."""
        recorded: dict = {}

        class _Client:
            def __init__(self, **kwargs: object) -> None:
                recorded["client"] = kwargs

        class _Provider:
            def __init__(self, **kwargs: object) -> None:
                recorded["provider"] = kwargs

        class _Model:
            def __init__(self, name: str, **kwargs: object) -> None:
                recorded["model"] = {"name": name, **kwargs}

        class _Agent:
            def __init__(self, model: object, **kwargs: object) -> None:
                recorded["agent"] = kwargs
                self.model = model

        class _ToolDefinition:
            def __init__(self, **definition: object) -> None:
                self.definition = definition

        class _ExternalToolset:
            def __init__(self, definitions: object, **options: object) -> None:
                self.definitions = definitions
                self.options = options

        _build_zero_retry_agent(
            "silo-default",
            "http://litellm.svc.cluster.local",
            "sk-attempt",
            "be careful",
            agent_cls=_Agent,
            model_cls=_Model,
            provider_cls=_Provider,
            async_openai=_Client,
            generated_output_capabilities=("image_png",),
            generated_output_configuration=_OpenAIGeneratedOutputConfiguration(
                ({"kind": "image_generation", "output_format": "png", "partial_images": 0},),
                {"openai_include_code_execution_outputs": True, "openai_include_raw_annotations": True},
            ),
            deferred_tool_requests_cls=type("_DeferredToolRequests", (), {}),
            external_toolset_cls=_ExternalToolset,
            tool_definition_cls=_ToolDefinition,
        )
        # Provider HTTP / model-request retries land on the OpenAI client transport as max_retries=0.
        self.assertEqual(recorded["client"]["max_retries"], 0)
        self.assertEqual(recorded["client"]["base_url"], "http://litellm.svc.cluster.local")
        self.assertEqual(recorded["client"]["api_key"], "sk-attempt")
        # The model is bound to that zero-retry client through the provider.
        self.assertIsInstance(recorded["provider"]["openai_client"], _Client)
        self.assertEqual(recorded["model"]["name"], "silo-default")
        # Tool-argument and output validation retries land on the Agent.
        self.assertEqual(recorded["agent"]["retries"], {"tools": 0, "output": 0})
        self.assertEqual(recorded["agent"]["capabilities"], ({"kind": "image_generation", "output_format": "png", "partial_images": 0},))
        self.assertEqual(recorded["agent"]["model_settings"], {"openai_include_code_execution_outputs": True, "openai_include_raw_annotations": True})
        self.assertEqual(recorded["agent"]["output_type"][0], str)
        self.assertEqual(recorded["agent"]["output_type"][1].__name__, "_DeferredToolRequests")
        self.assertEqual(recorded["agent"]["toolsets"][0].definitions[0].definition["name"], "opencrane_request_input")

    def test_compiled_memory_tool_reaches_model_as_external_tool(self) -> None:
        """The sealed memory schema is model-visible but has no runtime execution callback."""
        recorded: dict = {}

        class _Client:
            def __init__(self, **_kwargs: object) -> None:
                pass

        class _Provider:
            def __init__(self, **_kwargs: object) -> None:
                pass

        class _Model:
            def __init__(self, _name: str, **_kwargs: object) -> None:
                pass

        class _Agent:
            def __init__(self, _model: object, **kwargs: object) -> None:
                recorded["agent"] = kwargs

        class _ToolDefinition:
            def __init__(self, **kwargs: object) -> None:
                self.definition = kwargs

        class _ExternalToolset:
            def __init__(self, definitions: list[object], **kwargs: object) -> None:
                self.definitions = definitions
                self.options = kwargs

        schema = {
            "type": "object",
            "properties": {"query": {"type": "string", "minLength": 1, "maxLength": 2000}},
            "required": ["query"],
            "additionalProperties": False,
        }
        _build_zero_retry_agent(
            "silo-default",
            "http://litellm.svc.cluster.local",
            "sk-attempt",
            "be careful",
            [{
                "name": "memory_recall",
                "toolRevisionId": "memory:recall",
                "description": "Ask permission before recall.",
                "requiresApproval": True,
                "parametersSchema": schema,
            }],
            agent_cls=_Agent,
            model_cls=_Model,
            provider_cls=_Provider,
            async_openai=_Client,
            generated_output_configuration=_OpenAIGeneratedOutputConfiguration((), {}),
            external_toolset_cls=_ExternalToolset,
            tool_definition_cls=_ToolDefinition,
            deferred_tool_requests_cls=type("_DeferredToolRequests", (), {}),
        )

        toolsets = recorded["agent"]["toolsets"]
        self.assertEqual(len(toolsets), 1)
        self.assertEqual(toolsets[0].options, {"id": "opencrane-compiled-tools"})
        self.assertEqual(toolsets[0].definitions[0].definition, {
            "name": "memory_recall",
            "description": "Ask permission before recall.",
            "parameters_json_schema": schema,
        })
        self.assertIsNot(toolsets[0].definitions[0].definition["parameters_json_schema"], schema)
        self.assertEqual(toolsets[0].definitions[1].definition["name"], "opencrane_request_input")


class RuntimeDeferredToolBridgeTests(unittest.TestCase):
    """Prove same-attempt external tool calls survive the real pinned framework bridge."""

    def tearDown(self) -> None:
        """Keep subordinate framework history isolated between tests."""
        _clear_model_history("framework-run", 1)
        _clear_model_history("history-run", 2)

    def test_model_history_is_coordinate_bound_and_copy_safe(self) -> None:
        """History is replaced and copied only under one exact run-attempt key."""
        source = [{"message": "first"}]
        _store_model_history("history-run", 2, source)
        source.append({"message": "outside"})

        loaded = _load_model_history("history-run", 2)
        self.assertEqual(loaded, [{"message": "first"}])
        self.assertIsNone(_load_model_history("history-run", 1))
        assert loaded is not None
        loaded.append({"message": "changed-copy"})
        self.assertEqual(_load_model_history("history-run", 2), [{"message": "first"}])

        _clear_model_history("history-run", 2)
        self.assertIsNone(_load_model_history("history-run", 2))

    @unittest.skipUnless(importlib.util.find_spec("pydantic_ai"), "pydantic-ai is a qualification dependency")
    def test_pinned_framework_external_call_resumes_without_prompt_replay(self) -> None:
        """Pydantic 2.13 emits one complete call and accepts its result over saved history."""
        from pydantic_ai import Agent, DeferredToolRequests, ExternalToolset, ToolDefinition
        from pydantic_ai.models.test import TestModel

        tool_schema = {
            "type": "object",
            "properties": {"query": {"type": "string", "minLength": 1}},
            "required": ["query"],
            "additionalProperties": False,
        }
        agent = _build_zero_retry_agent(
            "test-model",
            "http://unused.invalid",
            "test-key",
            "Follow the compiled instructions.",
            [{
                "name": "memory_recall",
                "toolRevisionId": "memory:recall",
                "description": "Recall only after permission.",
                "requiresApproval": True,
                "parametersSchema": tool_schema,
            }],
            agent_cls=Agent,
            model_cls=lambda _name, **_kwargs: TestModel(call_tools=["memory_recall"]),
            provider_cls=lambda **_kwargs: object(),
            async_openai=lambda **_kwargs: object(),
            external_toolset_cls=ExternalToolset,
            tool_definition_cls=ToolDefinition,
            deferred_tool_requests_cls=DeferredToolRequests,
        )
        compiled_input = {
            "runId": "framework-run",
            "attempt": 1,
            "messages": [{"role": "user", "content": "What did I decide?"}],
        }
        cancel_event = threading.Event()

        def _model_components(_compiled_input: dict[str, object]) -> tuple[object, object, str, str]:
            return (agent, _OpenAIGeneratedOutputCollector(), "http://unused.invalid", "test-key")

        with mock.patch("src.model_loop.driver._model_loop_components", side_effect=_model_components):
            started = list(_pydantic_ai_event_source(compiled_input, cancel_event, []))
            calls = [event for event in started if event.get("type") == "tool_call"]
            self.assertEqual(len(calls), 1)
            self.assertEqual(calls[0]["toolName"], "memory_recall")
            self.assertTrue(calls[0]["toolCallId"])
            self.assertIn("query", json.loads(calls[0]["arguments"]))

            resumed = list(_pydantic_ai_resume_source(
                compiled_input,
                {calls[0]["toolCallId"]: {"facts": ["approved fact"]}},
                cancel_event,
                [],
            ))

        self.assertFalse(any(event.get("type") == "tool_call" for event in resumed))
        self.assertTrue(any(event.get("type") == "output_text" and event.get("text") for event in resumed))
        self.assertIsNotNone(_load_model_history("framework-run", 1))


class RuntimeExecutorTests(unittest.TestCase):
    """Validate the ``start_attempt`` executor over recorded neutral-event fixtures."""

    def test_streams_started_events_and_completed(self) -> None:
        """A streaming run emits started, ordered per-event candidates, then completed."""
        emitted: list[dict] = []
        fixture = [
            {"type": "output_text", "text": "part-1"},
            {"type": "tool_call", "toolName": "alpha", "toolCallId": "t1", "arguments": '{"q":"a"}'},
            {"type": "usage", "inputTokens": 5, "outputTokens": 7},
        ]
        _execute_start_attempt(_start_command(), "instance-1", emitted.append, event_source=lambda _compiled, _cancel, _steer: iter(fixture))
        kinds = [candidate["kind"] for candidate in emitted]
        self.assertEqual(kinds, ["event", "event", "event", "event", "external_action", "event", "event"])
        self.assertEqual([candidate.get("eventType") for candidate in emitted], ["run.started", "message.started", "message.delta", "tool.requested", None, "run.usage", "message.completed"])
        self.assertTrue(all(candidate["runId"] == "r1" and candidate["fence"] == 2 for candidate in emitted))

    def test_cancellation_clears_history_even_after_a_pending_tool_event(self) -> None:
        """A racing cancel cannot leave resumable framework history behind a pending call."""
        cancel_event = threading.Event()
        _store_model_history("r1", 1, [{"message": "private framework context"}])

        def _events(_compiled: dict, _cancel: threading.Event, _steering: list[str]):
            yield {"type": "tool_call", "toolName": "alpha", "toolCallId": "cancelled-call", "arguments": "{}"}
            cancel_event.set()

        _execute_start_attempt(
            _start_command(),
            "instance-1",
            lambda _candidate_body: None,
            event_source=_events,
            cancel_event=cancel_event,
        )

        self.assertIsNone(_load_model_history("r1", 1))

    def test_attempt_two_start_stores_and_clears_the_same_history_key(self) -> None:
        """Attempt-two model history cannot fall back to or clear the first-attempt key."""
        self.addCleanup(_clear_model_history, "r1", 1)
        self.addCleanup(_clear_model_history, "r1", 2)
        _store_model_history("r1", 1, [{"message": "older attempt"}])

        def _events(compiled: dict, _cancel: threading.Event, _steer: list[str]):
            _store_model_history(compiled["runId"], compiled["attempt"], [{"message": "attempt two"}])
            return iter([])

        _execute_start_attempt(_start_command(2), "instance-1", lambda _candidate: None, event_source=_events)

        self.assertIsNone(_load_model_history("r1", 2))
        self.assertEqual(_load_model_history("r1", 1), [{"message": "older attempt"}])

    def test_start_rejects_compiled_coordinates_from_another_attempt(self) -> None:
        """A start frame cannot make the driver store history under a different attempt."""
        emitted: list[dict] = []
        command = _start_command(2)
        command["payload"]["compiledInput"] = _compiled_input(attempt=1)

        _execute_start_attempt(command, "instance-1", emitted.append, event_source=lambda *_args: iter([]))

        self.assertEqual([candidate["eventType"] for candidate in emitted], ["run.failed"])
        self.assertEqual(emitted[0]["payload"], {"reason": "compiled_input_coordinate_mismatch"})

    def test_tool_call_surfaces_external_action_with_resolved_revision(self) -> None:
        """A granted tool call surfaces an external-action candidate with the compiled revision + digest."""
        emitted: list[dict] = []
        fixture = [{"type": "tool_call", "toolName": "zulu", "toolCallId": "t2", "arguments": '{"n":1}'}]
        with mock.patch("src.attempts.execution.run_evidence") as evidence:
            _execute_start_attempt(_start_command(), "instance-1", emitted.append, event_source=lambda _compiled, _cancel, _steer: iter(fixture))
        self.assertEqual(emitted[1]["eventType"], "tool.requested")
        action = emitted[2]
        self.assertEqual(action["kind"], "external_action")
        self.assertEqual(action["toolRevisionId"], "rev-zulu")
        self.assertEqual(action["toolInvocationId"], "t2")
        self.assertEqual(action["argumentsDigest"], _arguments_digest({"n": 1}))
        evidence.assert_any_call(mock.ANY, "waiting", waitReasons=[_RuntimeWaitReason.EXTERNAL_ACTION.value])

    def test_unknown_tool_call_is_a_hard_error(self) -> None:
        """A tool call outside the compiled grant set surfaces a hard ``unknown_tool`` error."""
        emitted: list[dict] = []
        fixture = [{"type": "tool_call", "toolName": "ghost", "toolCallId": "t9", "arguments": "{}"}]
        _execute_start_attempt(_start_command(), "instance-1", emitted.append, event_source=lambda _compiled, _cancel, _steer: iter(fixture))
        self.assertEqual([candidate.get("eventType") for candidate in emitted], ["run.started", "tool.failed", "run.completed"])
        self.assertEqual(emitted[1]["payload"], {"reason": "unknown_tool", "toolInvocationId": "t9"})

    def test_cancel_suppresses_late_output_and_completion(self) -> None:
        """Once cancellation fires mid-stream, no later candidate (or completion) is emitted."""
        emitted: list[dict] = []

        def _source(_compiled: dict, cancel: threading.Event, _steer: list):
            yield {"type": "output_text", "text": "before"}
            cancel.set()  # a cancel frame arrives while the loop is running
            yield {"type": "output_text", "text": "after"}

        _execute_start_attempt(_start_command(), "instance-1", emitted.append, event_source=_source, cancel_event=threading.Event())
        self.assertEqual([candidate["eventType"] for candidate in emitted], ["run.started", "message.started", "message.delta"])
        self.assertEqual(emitted[2]["payload"]["delta"], "before")

    def test_missing_compiled_input_is_a_terminal_failure(self) -> None:
        """A start command without compiled input surfaces `run.failed`, never a silent ack."""
        emitted: list[dict] = []
        command = _start_command()
        command["payload"] = {}
        _execute_start_attempt(command, "instance-1", emitted.append, event_source=lambda _compiled, _cancel, _steer: iter([]))
        self.assertEqual([candidate["eventType"] for candidate in emitted], ["run.failed"])
        self.assertEqual(emitted[0]["payload"]["reason"], "missing_compiled_input")

    def test_event_source_failure_surfaces_run_failed(self) -> None:
        """An executor failure with zero retries produces started then a single `run.failed`."""
        emitted: list[dict] = []

        def _boom(_compiled: dict, _cancel: threading.Event, _steer: list):
            raise RuntimeError("proxy unreachable")
            yield  # pragma: no cover - generator marker

        _execute_start_attempt(_start_command(), "instance-1", emitted.append, event_source=_boom)
        self.assertEqual([candidate["eventType"] for candidate in emitted], ["run.started", "run.failed"])
        self.assertEqual(emitted[1]["payload"], {"reason": "executor_failed", "errorType": "RuntimeError"})

    def test_malformed_command_emits_no_candidate(self) -> None:
        """A command missing its assignment yields no coordinates and therefore no candidate."""
        emitted: list[dict] = []
        _execute_start_attempt({"kind": "start_attempt", "commandId": "c1", "fence": 1}, "instance-1", emitted.append, event_source=lambda _compiled, _cancel, _steer: iter([]))
        self.assertEqual(emitted, [])

    def test_command_coordinates_bind_candidate_to_command(self) -> None:
        """Candidate coordinates echo the exact command instance, id, fence, run, and attempt."""
        coordinates = _command_coordinates(_start_command(), "instance-1")
        assert coordinates is not None
        candidate = _candidate(coordinates, "run.started", {})
        self.assertEqual(candidate["commandId"], "c1")
        self.assertEqual(candidate["attempt"], 1)
        self.assertEqual(candidate["kind"], "event")


class RuntimeResumeCancelTests(unittest.TestCase):
    """Validate resume feeds saved tool results and cancel is a positive-signal kill."""

    def test_resume_feeds_tool_results_into_the_loop(self) -> None:
        """Resume carries the input generation and injects the payload's saved results into the loop."""
        emitted: list[dict] = []
        captured: dict = {}

        def _resume_source(compiled_input, tool_results, _cancel, _steer):
            captured["compiledInput"] = compiled_input
            captured["results"] = tool_results
            return iter([{"type": "output_text", "text": "resumed"}, {"type": "usage", "inputTokens": 1, "outputTokens": 2}])

        _execute_resume_attempt(_resume_command(), "instance-1", emitted.append, resume_event_source=_resume_source)
        self.assertEqual(captured["results"], {})
        self.assertEqual(captured["compiledInput"], {})
        event_types = [candidate["eventType"] for candidate in emitted]
        self.assertEqual(event_types, ["run.resumed", "message.started", "message.delta", "run.usage", "message.completed", "run.completed"])
        self.assertEqual(emitted[0]["payload"], {"inputGeneration": 7})

    def test_resume_rejects_non_array_tool_results(self) -> None:
        """Resume fails closed before recovery when tool results violate the exact contract."""
        emitted: list[dict] = []
        command = _resume_command()
        command["payload"]["toolResults"] = {"t1": {"ok": True}}

        _execute_resume_attempt(command, "instance-1", emitted.append)

        self.assertEqual([candidate["eventType"] for candidate in emitted], ["run.failed"])
        self.assertEqual(emitted[0]["payload"], {"reason": "invalid_tool_results"})

    def test_resume_seeds_queued_steering_before_the_next_safe_boundary(self) -> None:
        """Resume passes validated owner steering to the executor's pre-model buffer."""
        command = _resume_command()
        command["payload"]["steeringRequests"] = [{"text": "Prioritise the current decision."}]
        captured: dict = {}

        def _resume_source(_compiled_input, _deferred, _cancel, steering_buffer):
            captured["steering"] = steering_buffer[:]
            return iter([])

        _execute_resume_attempt(command, "instance-1", lambda _candidate: None, resume_event_source=_resume_source)
        self.assertEqual(captured["steering"], ["Prioritise the current decision."])

    def test_resume_passes_the_injected_cipher_recovery_to_the_driver(self) -> None:
        """The model driver receives the exact coordinate-checked checkpoint, never a second cipher read."""
        emitted: list[dict] = []
        captured: dict = {}
        cipher = _ReversingCipher()
        compiled_input = _compiled_input()

        def _resume_source(recovered_input, _deferred, _cancel, _steering):
            captured["compiledInput"] = recovered_input
            return iter([])

        with tempfile.TemporaryDirectory() as directory:
            os.environ["OPENCRANE_RUNTIME_CHECKPOINT_DIR"] = directory
            try:
                _write_checkpoint("r1", 1, 7, {"compiledInput": compiled_input}, cipher=cipher, checkpoint_dir=directory)
                _execute_resume_attempt(_resume_command(), "instance-1", emitted.append, resume_event_source=_resume_source, checkpoint_cipher=cipher)
            finally:
                os.environ.pop("OPENCRANE_RUNTIME_CHECKPOINT_DIR", None)

        self.assertEqual(captured["compiledInput"], compiled_input)
        self.assertEqual([candidate["eventType"] for candidate in emitted], ["run.resumed", "run.completed"])

    def test_attempt_two_resume_recovers_and_clears_the_same_history_key(self) -> None:
        """Attempt-two resume reads and clears only its exact compiled-history coordinate."""
        self.addCleanup(_clear_model_history, "r1", 1)
        self.addCleanup(_clear_model_history, "r1", 2)
        cipher = _ReversingCipher()
        compiled_input = _compiled_input(attempt=2)
        _store_model_history("r1", 1, [{"message": "older attempt"}])
        _store_model_history("r1", 2, [{"message": "attempt two"}])

        def _resume_source(recovered_input, _deferred, _cancel, _steering):
            self.assertEqual((recovered_input["runId"], recovered_input["attempt"]), ("r1", 2))
            self.assertEqual(_load_model_history("r1", 2), [{"message": "attempt two"}])
            return iter([])

        with tempfile.TemporaryDirectory() as directory:
            os.environ["OPENCRANE_RUNTIME_CHECKPOINT_DIR"] = directory
            try:
                _write_checkpoint("r1", 2, 7, {"compiledInput": compiled_input}, cipher=cipher, checkpoint_dir=directory)
                _execute_resume_attempt(_resume_command(2), "instance-1", lambda _candidate: None, resume_event_source=_resume_source, checkpoint_cipher=cipher)
            finally:
                os.environ.pop("OPENCRANE_RUNTIME_CHECKPOINT_DIR", None)

        self.assertIsNone(_load_model_history("r1", 2))
        self.assertEqual(_load_model_history("r1", 1), [{"message": "older attempt"}])

    def test_missing_resume_payload_is_a_terminal_failure(self) -> None:
        """A resume command without a payload surfaces `run.failed`, never a silent ack."""
        emitted: list[dict] = []
        command = _resume_command()
        command["payload"] = None
        _execute_resume_attempt(command, "instance-1", emitted.append, resume_event_source=lambda *args: iter([]))
        self.assertEqual([candidate["eventType"] for candidate in emitted], ["run.failed"])
        self.assertEqual(emitted[0]["payload"]["reason"], "missing_resume_payload")

    def test_cancel_signals_the_active_task_without_a_runtime_terminal(self) -> None:
        """Cancel sets the shared event while the server retains the cancellation terminal outcome."""
        cancel_event = threading.Event()
        _execute_cancel_attempt(_cancel_command(), "instance-1", cancel_event=cancel_event)
        self.assertTrue(cancel_event.is_set())

    def test_attempt_two_cancel_clears_only_its_history_key(self) -> None:
        """An attempt-two cancel cannot leave or erase history under a neighbouring attempt."""
        self.addCleanup(_clear_model_history, "r1", 1)
        self.addCleanup(_clear_model_history, "r1", 2)
        _store_model_history("r1", 1, [{"message": "older attempt"}])
        _store_model_history("r1", 2, [{"message": "attempt two"}])

        _execute_cancel_attempt(_cancel_command(2), "instance-1")

        self.assertIsNone(_load_model_history("r1", 2))
        self.assertEqual(_load_model_history("r1", 1), [{"message": "older attempt"}])

    def test_cancel_before_the_active_task_emits_no_candidate_without_coordinates(self) -> None:
        """A cancel frame lacking coordinates yields no candidate and no crash when no task is active."""
        cancel_event = threading.Event()
        _execute_cancel_attempt({"kind": "cancel_attempt", "commandId": "c3", "fence": 1}, "instance-1", cancel_event=cancel_event)
        self.assertFalse(cancel_event.is_set())

    def test_completion_and_cancel_race_posts_exactly_one_terminal(self) -> None:
        """A cancel firing between the loop end and the completion post yields exactly one terminal."""
        emitted: list[dict] = []
        cancel_event = threading.Event()
        gate = _TerminalGate(cancel_event)

        def _source(_compiled, _cancel, _steer):
            yield {"type": "output_text", "text": "partial"}
            # Reader thread cancels in the check-then-act window, before the worker posts completion.
            _execute_cancel_attempt(_cancel_command(), "instance-1", cancel_event=cancel_event)

        _execute_start_attempt(_start_command(), "instance-1", emitted.append, event_source=_source, cancel_event=cancel_event, terminal_gate=gate)
        terminals = [candidate["eventType"] for candidate in emitted if candidate["eventType"] in ("run.completed", "run.failed", "run.cancelled")]
        self.assertEqual(terminals, [])

    def test_completion_then_late_cancel_keeps_the_single_terminal(self) -> None:
        """When completion wins the race, a late cancel is a no-op and does not add a second terminal."""
        emitted: list[dict] = []
        cancel_event = threading.Event()
        gate = _TerminalGate(cancel_event)
        _execute_start_attempt(_start_command(), "instance-1", emitted.append, event_source=lambda _compiled, _cancel, _steer: iter([]), cancel_event=cancel_event, terminal_gate=gate)
        _execute_cancel_attempt(_cancel_command(), "instance-1", cancel_event=cancel_event)
        terminals = [candidate["eventType"] for candidate in emitted if candidate["eventType"] in ("run.completed", "run.failed", "run.cancelled")]
        self.assertEqual(terminals, ["run.completed"])

    def test_failed_completion_delivery_retries_the_same_terminal_candidate(self) -> None:
        """An ambiguous terminal network loss retries one stable id rather than inventing a failure."""
        cancel_event = threading.Event()
        gate = _TerminalGate(cancel_event)
        delivered: list[dict] = []
        attempts = 0

        def _reject_completion(candidate: dict) -> None:
            nonlocal attempts
            attempts += 1
            if attempts == 1:
                raise URLError("connection reset before response")
            delivered.append(candidate)

        coordinates = _command_coordinates(_start_command(), "instance-1")
        assert coordinates is not None
        self.assertTrue(gate.post_completion(_reject_completion, _candidate(coordinates, "run.completed", {})))
        self.assertEqual(attempts, 2)
        self.assertEqual([candidate["eventType"] for candidate in delivered], ["run.completed"])

    def test_explicit_terminal_http_refusal_is_not_retried(self) -> None:
        """A permanent server decision propagates once instead of creating an unbounded replay loop."""
        gate = _TerminalGate(threading.Event())
        coordinates = _command_coordinates(_start_command(), "instance-1")
        assert coordinates is not None
        terminal = _candidate(coordinates, "run.completed", {})
        attempts = 0

        def _reject(_candidate_body: dict) -> None:
            nonlocal attempts
            attempts += 1
            raise HTTPError(
                "https://control.example/candidates",
                409,
                "terminal conflict",
                {},
                io.BytesIO(b'{"accepted":false}'),
            )

        captured = io.StringIO()
        with contextlib.redirect_stdout(captured):
            with self.assertRaises(HTTPError) as raised:
                gate.post_completion(_reject, terminal)

        self.assertTrue(raised.exception.fp.closed)
        self.assertEqual(attempts, 1)
        refusal = json.loads(captured.getvalue())
        self.assertEqual(refusal["event"], "terminal_candidate_refused")
        self.assertEqual(refusal["candidateId"], terminal["candidateId"])
        self.assertEqual(refusal["status"], 409)


class RuntimePydanticAiDriverTests(unittest.TestCase):
    """Guard the live driver import so offline runs do not claim live qualification."""

    @unittest.skipUnless(importlib.util.find_spec("pydantic_ai") is not None, "pydantic-ai is installed only in the live-LiteLLM qualification environment")
    def test_driver_module_is_importable_when_present(self) -> None:  # pragma: no cover - live environment only
        """When the pinned framework is present, the lazily imported driver symbols resolve."""
        from pydantic_ai import Agent  # noqa: F401
        from pydantic_ai.models.openai import OpenAIResponsesModel  # noqa: F401
        from pydantic_ai.providers.openai import OpenAIProvider  # noqa: F401


class RuntimeWarmBindingGateTests(unittest.TestCase):
    """Validate the one-use warm binding before any stream opens."""

    def setUp(self) -> None:
        """Point the shell at temp credential files and a fake proof key without cryptography."""
        self._token = tempfile.NamedTemporaryFile("w", suffix=".token", delete=False)
        self._token.write("projected-token")
        self._token.flush()
        self._token.close()
        os.environ["OPENCRANE_RUNTIME_STREAM_URL"] = "http://opencrane.svc/api/internal/agent-runtime"
        os.environ["OPENCRANE_RUNTIME_TOKEN_PATH"] = self._token.name
        os.environ["POD_UID"] = "pod-1"
        os.environ["OPENCRANE_WARM_BINDING_PORT"] = "8081"
        os.environ["OPENCRANE_WARM_PROFILE"] = "personal-claimed"
        self._proof_key = {"publicJwk": {"kty": "EC", "crv": "P-256", "x": "a", "y": "b"}, "thumbprint": "t"}

    def tearDown(self) -> None:
        """Restore the real keygen and remove the temporary credential files."""
        os.unlink(self._token.name)
        for name in ("OPENCRANE_RUNTIME_STREAM_URL", "OPENCRANE_RUNTIME_TOKEN_PATH", "POD_UID", "OPENCRANE_WARM_BINDING_PORT", "OPENCRANE_WARM_PROFILE"):
            os.environ.pop(name, None)

    def test_denied_warm_binding_never_opens_a_stream(self) -> None:
        """A refused warm binding ends the process without opening a command stream."""
        opened: list[str] = []

        def _deny(_url: str, _token: str, _key: dict) -> str:
            raise BootstrapDeniedError("already consumed")

        def _open(_url: str, _token: str, _instance: str, _pod: str, *, attempt_model_key: str) -> int:
            opened.append(_instance)
            return 0

        run_forever(
            open_stream=_open,
            perform_warm_binding=_deny,
            generate_key=lambda: self._proof_key,
            start_warm_readiness_server=lambda _port, _pod, _profile: object(),
        )
        self.assertEqual(opened, [])

    def test_successful_warm_binding_precedes_the_stream(self) -> None:
        """Readiness and one warm binding happen before the command stream opens."""
        calls: list[str] = []

        def _ready(_port: int, _pod: str, _profile: str) -> object:
            calls.append("readiness")
            return object()

        def _bind(_url: str, _token: str, _key: dict) -> str:
            calls.append("binding")
            return "attempt-model-key"

        class _Stop(Exception):
            """Sentinel to break the otherwise infinite reconnect loop after one open."""

        def _open(_url: str, _token: str, _instance: str, _pod: str, *, attempt_model_key: str) -> int:
            self.assertEqual(attempt_model_key, "attempt-model-key")
            calls.append("stream")
            raise _Stop()

        with self.assertRaises(_Stop):
            run_forever(
                open_stream=_open,
                perform_warm_binding=_bind,
                generate_key=lambda: self._proof_key,
                start_warm_readiness_server=_ready,
            )
        self.assertEqual(calls, ["readiness", "binding", "stream"])

    def test_clean_stream_eof_uses_bounded_reconnect_backoff(self) -> None:
        """A peer returning immediate 200/EOF cannot force the runtime into a hot reconnect loop."""
        opens = 0

        def _bind(_url: str, _token: str, _key: dict) -> str:
            return "attempt-model-key"

        class _Stop(Exception):
            """Sentinel raised after observing the reconnect attempt."""

        def _open(_url: str, _token: str, _instance: str, _pod: str, *, attempt_model_key: str) -> int:
            nonlocal opens
            self.assertEqual(attempt_model_key, "attempt-model-key")
            opens += 1
            if opens == 2:
                raise _Stop()
            return 0

        with mock.patch("src.runtime.time.sleep") as sleep:
            with self.assertRaises(_Stop):
                run_forever(
                    open_stream=_open,
                    perform_warm_binding=_bind,
                    generate_key=lambda: self._proof_key,
                    start_warm_readiness_server=lambda _port, _pod, _profile: object(),
                )

        self.assertEqual(opens, 2)
        sleep.assert_called_once()
        self.assertGreater(sleep.call_args.args[0], 0)


if __name__ == "__main__":
    unittest.main()
