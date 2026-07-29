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
from src.bootstrap.proof import rfc7638_thumbprint as _rfc7638_thumbprint
from src.constants import CHECKPOINT_FILENAME
from src.model_loop.checkpoints import (
    checkpoint_path as _checkpoint_path,
    read_checkpoint as _read_checkpoint,
    write_checkpoint as _write_checkpoint,
)
from src.model_loop.driver import (
    absorb_steering as _absorb_steering,
    build_zero_retry_agent as _build_zero_retry_agent,
    zero_retry_openai_settings as _zero_retry_openai_settings,
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
from src.runtime import retry_delay as _retry_delay, run_forever
from src.transport.http import post_candidate_with_retry as _post_candidate_with_retry
from src.transport.stream import (
    _AttemptWorkerRegistry,
    iter_commands as _iter_commands,
)


def _compiled_input() -> dict:
    """Build a compiled input whose grant set fixes the ``alpha`` and ``zulu`` tool revisions."""
    return {
        "promptCompilerVersion": "v1",
        "instructions": "be careful",
        "messages": [{"role": "user", "content": "hi"}],
        "tools": [
            {"name": "alpha", "toolRevisionId": "rev-alpha", "description": "", "parametersSchema": {}},
            {"name": "zulu", "toolRevisionId": "rev-zulu", "description": "", "parametersSchema": {}},
        ],
        "model": {"modelAlias": "silo-default", "maxOutputTokens": None},
        "budget": {},
        "digest": "sha256:x",
    }


def _start_command() -> dict:
    """Build one structurally valid ``start_attempt`` command carrying a compiled input."""
    return {
        "kind": "start_attempt",
        "commandId": "c1",
        "fence": 2,
        "assignment": {"runId": "r1", "attempt": 1},
        "payload": {"snapshot": {"inputGeneration": 4}, "compiledInput": _compiled_input()},
    }


def _resume_command() -> dict:
    """Build one structurally valid ``resume_attempt`` command carrying authorized deferred results."""
    return {
        "kind": "resume_attempt",
        "commandId": "c2",
        "fence": 2,
        "assignment": {"runId": "r1", "attempt": 1},
        "payload": {"inputGeneration": 7, "deferredToolResults": {"t1": {"ok": True}}, "steeringRequests": []},
    }


def _cancel_command() -> dict:
    """Build one structurally valid ``cancel_attempt`` command carrying a server-chosen reason."""
    return {
        "kind": "cancel_attempt",
        "commandId": "c3",
        "fence": 2,
        "assignment": {"runId": "r1", "attempt": 1},
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

    def test_retryable_candidate_response_replays_the_same_candidate_until_accepted(self) -> None:
        """A pre-reservation 503 retries one unchanged candidate and never creates a second action."""
        candidate = {"candidateId": "candidate-retry", "runId": "r1", "attempt": 1, "kind": "external_action"}
        sent: list[dict] = []

        def _post(_url: str, _token: str, body: dict, _timeout: float) -> int:
            sent.append(body)
            if len(sent) == 1:
                raise HTTPError("https://control.example/candidates", 503, "retry", {}, io.BytesIO(b'{"accepted":false,"reason":"external_action_dispatch_retryable","retryable":true,"retryAfterMilliseconds":1}'))
            return 202

        _post_candidate_with_retry("https://control.example", "projected-token", candidate, threading.Event(), _post)

        self.assertEqual(sent, [candidate, candidate])

    def test_attempt_cancellation_stops_a_retry_wait_without_reposting_the_candidate(self) -> None:
        """The active attempt's cancel signal interrupts a retry wait before a second submission."""
        class _CancelsDuringWait(threading.Event):
            """Set itself from the retry wait to model a cancel racing the server-selected delay."""

            def __init__(self) -> None:
                """Record entry into the retry wait for the assertion."""
                super().__init__()
                self.wait_entered = False

            def wait(self, timeout: float | None = None) -> bool:
                """Signal cancellation while the retry helper is waiting for the next submission."""
                self.wait_entered = True
                self.set()
                return True

        cancelled = _CancelsDuringWait()
        candidate = {"candidateId": "candidate-cancelled-retry", "runId": "r1", "attempt": 1, "kind": "external_action"}
        sent: list[dict] = []

        def _post(_url: str, _token: str, body: dict, _timeout: float) -> int:
            sent.append(body)
            raise HTTPError("https://control.example/candidates", 503, "retry", {}, io.BytesIO(b'{"accepted":false,"reason":"external_action_dispatch_retryable","retryable":true,"retryAfterMilliseconds":1}'))

        _post_candidate_with_retry("https://control.example", "projected-token", candidate, cancelled, _post)

        self.assertTrue(cancelled.wait_entered)
        self.assertEqual(sent, [candidate])

    def test_server_retry_exhaustion_stops_the_client_retry_loop(self) -> None:
        """A terminal server rejection ends retries after its durable budget is exhausted."""
        candidate = {"candidateId": "candidate-exhausted", "runId": "r1", "attempt": 1, "kind": "external_action"}
        sent: list[dict] = []

        def _post(_url: str, _token: str, body: dict, _timeout: float) -> int:
            sent.append(body)
            if len(sent) <= 3:
                raise HTTPError("https://control.example/candidates", 503, "retry", {}, io.BytesIO(b'{"accepted":false,"reason":"external_action_dispatch_retryable","retryable":true,"retryAfterMilliseconds":1}'))
            raise HTTPError("https://control.example/candidates", 409, "exhausted", {}, io.BytesIO(b'{"accepted":false,"reason":"external_action_dispatch_retry_exhausted"}'))

        with self.assertRaises(HTTPError) as raised:
            _post_candidate_with_retry("https://control.example", "projected-token", candidate, threading.Event(), _post)

        self.assertEqual(raised.exception.code, 409)
        raised.exception.close()
        self.assertEqual(sent, [candidate, candidate, candidate, candidate])

    def test_retryable_candidate_response_does_not_terminalise_the_model_loop(self) -> None:
        """A recovered same-candidate retry lets the attempt complete without a synthetic run error."""
        posted: list[dict] = []
        attempts = 0

        def _post(_url: str, _token: str, body: dict, _timeout: float) -> int:
            nonlocal attempts
            attempts += 1
            if body.get("kind") == "external_action" and attempts == 2:
                raise HTTPError("https://control.example/candidates", 503, "retry", {}, io.BytesIO(b'{"accepted":false,"reason":"external_action_dispatch_retryable","retryable":true,"retryAfterMilliseconds":1}'))
            return 202

        def _post_candidate(candidate: dict) -> None:
            posted.append(candidate)
            _post_candidate_with_retry("https://control.example", "projected-token", candidate, threading.Event(), _post)

        _execute_start_attempt(_start_command(), "instance-1", _post_candidate, event_source=lambda _compiled, _cancel, _steer: iter([{"type": "tool_call", "toolName": "alpha", "toolCallId": "t1", "arguments": "{}"}]))

        self.assertEqual(attempts, 4)
        self.assertEqual([candidate.get("eventType") for candidate in posted], ["run.started", None, "run.completed"])


class RuntimeThumbprintTests(unittest.TestCase):
    """Validate the RFC 7638 thumbprint matches the canonical EC member order."""

    def test_thumbprint_is_deterministic_unpadded_base64url(self) -> None:
        """The digest is a stable 43-char unpadded base64url SHA-256 that changes with the key."""
        first = _rfc7638_thumbprint("x-coordinate", "y-coordinate")
        self.assertEqual(len(first), 43)
        self.assertNotIn("=", first)
        self.assertEqual(first, _rfc7638_thumbprint("x-coordinate", "y-coordinate"))
        self.assertNotEqual(first, _rfc7638_thumbprint("x-coordinate", "other-coordinate"))


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
        """A text delta becomes a bounded ``run.output_text`` payload."""
        self.assertEqual(_normalize_event({"type": "output_text", "text": "hello"}), ("run.output_text", {"text": "hello"}))

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
        self.assertEqual(candidate["eventType"], "run.error")
        self.assertEqual(candidate["payload"], {"reason": "unknown_tool", "toolCallId": "t9"})

    def test_malformed_arguments_become_error(self) -> None:
        """Unparseable tool arguments become a ``run.error`` rather than an external action."""
        event = {"type": "tool_call", "toolName": "alpha", "toolCallId": "t1", "arguments": '{"q":'}
        candidate = _tool_call_candidate(self._coordinates(), _compiled_input(), event)
        self.assertEqual(candidate["eventType"], "run.error")
        self.assertEqual(candidate["payload"], {"reason": "malformed_tool_call", "toolCallId": "t1"})

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

        _build_zero_retry_agent(
            "silo-default",
            "http://litellm.svc.cluster.local",
            "sk-attempt",
            "be careful",
            agent_cls=_Agent,
            model_cls=_Model,
            provider_cls=_Provider,
            async_openai=_Client,
        )
        # Provider HTTP / model-request retries land on the OpenAI client transport as max_retries=0.
        self.assertEqual(recorded["client"]["max_retries"], 0)
        self.assertEqual(recorded["client"]["base_url"], "http://litellm.svc.cluster.local")
        self.assertEqual(recorded["client"]["api_key"], "sk-attempt")
        # The model is bound to that zero-retry client through the provider.
        self.assertIsInstance(recorded["provider"]["openai_client"], _Client)
        self.assertEqual(recorded["model"]["name"], "silo-default")
        # Tool-argument and output validation retries land on the Agent.
        self.assertEqual(recorded["agent"]["retries"], 0)
        self.assertEqual(recorded["agent"]["output_retries"], 0)


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
        self.assertEqual(kinds, ["event", "event", "external_action", "event", "event"])
        self.assertEqual([emitted[0]["eventType"], emitted[1]["eventType"], emitted[3]["eventType"], emitted[4]["eventType"]], ["run.started", "run.output_text", "run.usage", "run.completed"])
        self.assertTrue(all(candidate["runId"] == "r1" and candidate["fence"] == 2 for candidate in emitted))

    def test_tool_call_surfaces_external_action_with_resolved_revision(self) -> None:
        """A granted tool call surfaces an external-action candidate with the compiled revision + digest."""
        emitted: list[dict] = []
        fixture = [{"type": "tool_call", "toolName": "zulu", "toolCallId": "t2", "arguments": '{"n":1}'}]
        _execute_start_attempt(_start_command(), "instance-1", emitted.append, event_source=lambda _compiled, _cancel, _steer: iter(fixture))
        action = emitted[1]
        self.assertEqual(action["kind"], "external_action")
        self.assertEqual(action["toolRevisionId"], "rev-zulu")
        self.assertEqual(action["toolInvocationId"], "t2")
        self.assertEqual(action["argumentsDigest"], _arguments_digest({"n": 1}))

    def test_unknown_tool_call_is_a_hard_error(self) -> None:
        """A tool call outside the compiled grant set surfaces a hard ``unknown_tool`` error."""
        emitted: list[dict] = []
        fixture = [{"type": "tool_call", "toolName": "ghost", "toolCallId": "t9", "arguments": "{}"}]
        _execute_start_attempt(_start_command(), "instance-1", emitted.append, event_source=lambda _compiled, _cancel, _steer: iter(fixture))
        self.assertEqual([candidate.get("eventType") for candidate in emitted], ["run.started", "run.error", "run.completed"])
        self.assertEqual(emitted[1]["payload"], {"reason": "unknown_tool", "toolCallId": "t9"})

    def test_cancel_suppresses_late_output_and_completion(self) -> None:
        """Once cancellation fires mid-stream, no later candidate (or completion) is emitted."""
        emitted: list[dict] = []

        def _source(_compiled: dict, cancel: threading.Event, _steer: list):
            yield {"type": "output_text", "text": "before"}
            cancel.set()  # a cancel frame arrives while the loop is running
            yield {"type": "output_text", "text": "after"}

        _execute_start_attempt(_start_command(), "instance-1", emitted.append, event_source=_source, cancel_event=threading.Event())
        self.assertEqual([candidate["eventType"] for candidate in emitted], ["run.started", "run.output_text"])
        self.assertEqual(emitted[1]["payload"]["text"], "before")

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
    """Validate resume feeds authorized deferred results and cancel is a positive-signal kill."""

    def test_resume_feeds_deferred_results_into_the_loop(self) -> None:
        """Resume carries the input generation and injects the payload's deferred results into the loop."""
        emitted: list[dict] = []
        captured: dict = {}

        def _resume_source(run_id, attempt, input_generation, deferred_tool_results, _cancel, _steer):
            captured["runId"] = run_id
            captured["attempt"] = attempt
            captured["inputGeneration"] = input_generation
            captured["deferred"] = deferred_tool_results
            return iter([{"type": "output_text", "text": "resumed"}, {"type": "usage", "inputTokens": 1, "outputTokens": 2}])

        _execute_resume_attempt(_resume_command(), "instance-1", emitted.append, resume_event_source=_resume_source)
        self.assertEqual(captured["deferred"], {"t1": {"ok": True}})
        self.assertEqual(captured["inputGeneration"], 7)
        self.assertEqual((captured["runId"], captured["attempt"]), ("r1", 1))
        event_types = [candidate["eventType"] for candidate in emitted]
        self.assertEqual(event_types, ["run.resumed", "run.output_text", "run.usage", "run.completed"])
        self.assertEqual(emitted[0]["payload"], {"inputGeneration": 7})

    def test_resume_seeds_queued_steering_before_the_next_safe_boundary(self) -> None:
        """Resume passes validated owner steering to the executor's pre-model buffer."""
        command = _resume_command()
        command["payload"]["steeringRequests"] = [{"text": "Prioritise the current decision."}]
        captured: dict = {}

        def _resume_source(_run_id, _attempt, _generation, _deferred, _cancel, steering_buffer):
            captured["steering"] = steering_buffer[:]
            return iter([])

        _execute_resume_attempt(command, "instance-1", lambda _candidate: None, resume_event_source=_resume_source)
        self.assertEqual(captured["steering"], ["Prioritise the current decision."])

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
        terminals = [candidate["eventType"] for candidate in emitted if candidate["eventType"] in ("run.completed", "run.error", "run.cancelled")]
        self.assertEqual(terminals, [])

    def test_completion_then_late_cancel_keeps_the_single_terminal(self) -> None:
        """When completion wins the race, a late cancel is a no-op and does not add a second terminal."""
        emitted: list[dict] = []
        cancel_event = threading.Event()
        gate = _TerminalGate(cancel_event)
        _execute_start_attempt(_start_command(), "instance-1", emitted.append, event_source=lambda _compiled, _cancel, _steer: iter([]), cancel_event=cancel_event, terminal_gate=gate)
        _execute_cancel_attempt(_cancel_command(), "instance-1", cancel_event=cancel_event)
        terminals = [candidate["eventType"] for candidate in emitted if candidate["eventType"] in ("run.completed", "run.error", "run.cancelled")]
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
        from pydantic_ai.models.openai import OpenAIModel  # noqa: F401
        from pydantic_ai.providers.openai import OpenAIProvider  # noqa: F401


class RuntimeBootstrapGateTests(unittest.TestCase):
    """Validate the one-use bootstrap gate before any stream opens."""

    def setUp(self) -> None:
        """Point the shell at temp credential files and a fake proof key without cryptography."""
        self._token = tempfile.NamedTemporaryFile("w", suffix=".token", delete=False)
        self._token.write("projected-token")
        self._token.flush()
        self._token.close()
        self._bootstrap = tempfile.NamedTemporaryFile("w", suffix=".ref", delete=False)
        self._bootstrap.write("bootstrap-v1_" + "a" * 64)
        self._bootstrap.flush()
        self._bootstrap.close()
        os.environ["OPENCRANE_RUNTIME_STREAM_URL"] = "http://opencrane.svc/api/internal/agent-runtime"
        os.environ["OPENCRANE_RUNTIME_TOKEN_PATH"] = self._token.name
        os.environ["OPENCRANE_RUNTIME_BOOTSTRAP_PATH"] = self._bootstrap.name
        os.environ["POD_UID"] = "pod-1"
        self._proof_key = {"publicJwk": {"kty": "EC", "crv": "P-256", "x": "a", "y": "b"}, "thumbprint": "t"}

    def tearDown(self) -> None:
        """Restore the real keygen and remove the temporary credential files."""
        os.unlink(self._token.name)
        os.unlink(self._bootstrap.name)
        for name in ("OPENCRANE_RUNTIME_STREAM_URL", "OPENCRANE_RUNTIME_TOKEN_PATH", "OPENCRANE_RUNTIME_BOOTSTRAP_PATH", "POD_UID"):
            os.environ.pop(name, None)

    def test_denied_bootstrap_never_opens_a_stream(self) -> None:
        """A refused bootstrap ends the process fail-closed without opening a command stream."""
        opened: list[str] = []

        def _deny(_url: str, _token: str, _reference: str, _key: dict) -> None:
            raise BootstrapDeniedError("already consumed")

        def _open(_url: str, _token: str, _instance: str, _pod: str) -> int:
            opened.append(_instance)
            return 0

        run_forever(
            open_stream=_open,
            perform_bootstrap=_deny,
            generate_key=lambda: self._proof_key,
        )
        self.assertEqual(opened, [])

    def test_successful_bootstrap_precedes_the_stream(self) -> None:
        """The stream opens only after exactly one successful bootstrap binding."""
        calls: list[str] = []

        def _bind(_url: str, _token: str, _reference: str, _key: dict) -> None:
            calls.append("bootstrap")

        class _Stop(Exception):
            """Sentinel to break the otherwise infinite reconnect loop after one open."""

        def _open(_url: str, _token: str, _instance: str, _pod: str) -> int:
            calls.append("stream")
            raise _Stop()

        with self.assertRaises(_Stop):
            run_forever(
                open_stream=_open,
                perform_bootstrap=_bind,
                generate_key=lambda: self._proof_key,
            )
        self.assertEqual(calls, ["bootstrap", "stream"])

    def test_clean_stream_eof_uses_bounded_reconnect_backoff(self) -> None:
        """A peer returning immediate 200/EOF cannot force the runtime into a hot reconnect loop."""
        opens = 0

        def _bind(_url: str, _token: str, _reference: str, _key: dict) -> None:
            return None

        class _Stop(Exception):
            """Sentinel raised after observing the reconnect attempt."""

        def _open(_url: str, _token: str, _instance: str, _pod: str) -> int:
            nonlocal opens
            opens += 1
            if opens == 2:
                raise _Stop()
            return 0

        with mock.patch("src.runtime.time.sleep") as sleep:
            with self.assertRaises(_Stop):
                run_forever(
                    open_stream=_open,
                    perform_bootstrap=_bind,
                    generate_key=lambda: self._proof_key,
                )

        self.assertEqual(opens, 2)
        sleep.assert_called_once()
        self.assertGreater(sleep.call_args.args[0], 0)


if __name__ == "__main__":
    unittest.main()
