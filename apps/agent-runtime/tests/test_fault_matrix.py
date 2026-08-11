"""Fault-injection matrix for the OpenCrane runtime's protocol and reliability invariants.

Every scenario here is an OpenCrane-owned protocol/reliability fault that needs no live LiteLLM: it
injects a hostile or degraded condition at the runtime's own seams and asserts the reliability
invariant holds. The fixtures are independently authored plain frames — no transcript, no framework,
no network.

The asserted invariants, per the slice-4 matrix, are: no duplicate side effect, no split-brain
writer, no lost / reordered / late event after a terminal, no unbounded retry, and no credential leak.
"""

import io
import json
import tempfile
import threading
import unittest

from src.constants import MAX_FRAME_BYTES as _MAX_FRAME_BYTES
from src.model_loop.checkpoints import (
    checkpoint_path as _checkpoint_path,
    read_checkpoint as _read_checkpoint,
    write_checkpoint as _write_checkpoint,
)
from src.attempts.execution import (
    execute_cancel_attempt as _execute_cancel_attempt,
    execute_start_attempt as _execute_start_attempt,
)
from src.attempts.terminal import TerminalGate as _TerminalGate
from src.protocol.candidates import (
    arguments_digest as _arguments_digest,
    command_coordinates as _command_coordinates,
    tool_call_candidate as _tool_call_candidate,
)
from src.runtime import retry_delay as _retry_delay
from src.transport.stream import iter_commands as _iter_commands


class _ReversingCipher:
    """A reversible in-test cipher so stale-coordinate checkpoints can be exercised without crypto."""

    def encrypt(self, data: bytes) -> bytes:
        return b"v:" + data[::-1]

    def decrypt(self, token: bytes) -> bytes:
        if not token.startswith(b"v:"):
            raise ValueError("bad token")
        return token[len(b"v:"):][::-1]


def _compiled_input() -> dict:
    """Compiled input fixing exactly one granted tool revision for revision-fault scenarios."""
    return {
        "promptCompilerVersion": "v1",
        "runId": "run-fault",
        "attempt": 2,
        "instructions": "",
        "messages": [{"role": "user", "content": "hi"}],
        "tools": [{"name": "search", "toolRevisionId": "rev-search", "description": "", "parametersSchema": {}}],
        "model": {"modelAlias": "silo-default", "generatedOutputCapabilities": []},
        "budget": {},
        "digest": "sha256:fault",
    }


def _start_command() -> dict:
    """One structurally valid ``start_attempt`` command for terminal and cancellation scenarios."""
    return {
        "kind": "start_attempt",
        "commandId": "cmd-start",
        "fence": 4,
        "assignment": {"runId": "run-fault", "attempt": 2},
        "payload": {"snapshot": {"inputGeneration": 5}, "compiledInput": _compiled_input()},
    }


def _cancel_command() -> dict:
    """One structurally valid ``cancel_attempt`` command sharing the start coordinates."""
    return {
        "kind": "cancel_attempt",
        "commandId": "cmd-cancel",
        "fence": 4,
        "assignment": {"runId": "run-fault", "attempt": 2},
        "payload": {"reason": "superseded"},
    }


def _coordinates() -> dict:
    """Resolve the start command's immutable candidate coordinates."""
    coordinates = _command_coordinates(_start_command(), "instance-fault")
    assert coordinates is not None
    return coordinates


class FaultDuplicateAndReplayTests(unittest.TestCase):
    """Duplicate frames, duplicate candidates, and replayed invocation ids cause no double effect."""

    def test_duplicate_command_frames_map_to_identical_stable_coordinates(self) -> None:
        """Two deliveries of the same command frame bind to identical coordinates for idempotent dedup."""
        first = _command_coordinates(_start_command(), "instance-fault")
        second = _command_coordinates(_start_command(), "instance-fault")
        self.assertEqual(first, second)

    def test_replayed_invocation_id_yields_a_deterministic_digest(self) -> None:
        """A replayed tool invocation id over identical args yields the same digest the authority re-derives."""
        event = {"type": "tool_call", "toolName": "search", "toolCallId": "call-replay", "arguments": '{"q":"a"}'}
        first = _tool_call_candidate(_coordinates(), _compiled_input(), event)
        second = _tool_call_candidate(_coordinates(), _compiled_input(), event)
        self.assertEqual(first["toolInvocationId"], second["toolInvocationId"])
        self.assertEqual(first["argumentsDigest"], second["argumentsDigest"])
        self.assertEqual(first["argumentsDigest"], _arguments_digest({"q": "a"}))


class FaultTerminalGateTests(unittest.TestCase):
    """Exactly one terminal posts across the reader and worker threads (no split-brain writer)."""

    def test_completion_then_late_cancel_keeps_the_single_terminal(self) -> None:
        """When completion wins, a late cancel is a no-op — no second terminal is written."""
        emitted: list[dict] = []
        cancel_event = threading.Event()
        gate = _TerminalGate(cancel_event)
        _execute_start_attempt(_start_command(), "instance-fault", emitted.append, event_source=lambda _c, _x, _s: iter([]), cancel_event=cancel_event, terminal_gate=gate)
        _execute_cancel_attempt(_cancel_command(), "instance-fault", cancel_event=cancel_event)
        terminals = [candidate["eventType"] for candidate in emitted if candidate["eventType"] in ("run.completed", "run.failed", "run.cancelled")]
        self.assertEqual(terminals, ["run.completed"])

    def test_cancel_in_the_check_then_act_window_posts_no_runtime_terminal(self) -> None:
        """A cancel firing between loop end and completion post leaves terminal state server-owned."""
        emitted: list[dict] = []
        cancel_event = threading.Event()
        gate = _TerminalGate(cancel_event)

        def _source(_compiled, _cancel, _steering):
            yield {"type": "output_text", "text": "partial"}
            _execute_cancel_attempt(_cancel_command(), "instance-fault", cancel_event=cancel_event)

        _execute_start_attempt(_start_command(), "instance-fault", emitted.append, event_source=_source, cancel_event=cancel_event, terminal_gate=gate)
        terminals = [candidate["eventType"] for candidate in emitted if candidate["eventType"] in ("run.completed", "run.failed", "run.cancelled")]
        self.assertEqual(terminals, [])


class FaultStreamLossTests(unittest.TestCase):
    """Command-stream loss and disconnected/slow peers bound work without a late event or retry storm."""

    def test_command_reading_stops_the_instant_the_stream_is_marked_lost(self) -> None:
        """A set cancellation flag stops command reading so a dropped stream cannot keep dispatching."""
        cancelled = threading.Event()
        cancelled.set()
        self.assertEqual(list(_iter_commands(iter([b"event: command\n", b'data: {"kind":"x"}\n', b"\n"]), cancelled)), [])

    def test_pod_or_peer_loss_mid_stream_suppresses_every_later_candidate(self) -> None:
        """When cancellation (the stream-loss fallback) fires mid-stream, no later candidate is emitted."""
        cancel_event = threading.Event()

        def _source(_compiled, cancel, _steering):
            yield {"type": "output_text", "text": "one"}
            cancel.set()  # peer/pod loss trips the fence-bump + stream-loss cancellation fallback
            yield {"type": "output_text", "text": "two"}

        emitted: list[dict] = []
        _execute_start_attempt(_start_command(), "instance-fault", emitted.append, event_source=_source, cancel_event=cancel_event)
        self.assertEqual([candidate.get("eventType") for candidate in emitted], ["run.started", "message.started", "message.delta"])

    def test_reconnect_backoff_is_bounded_so_a_dead_peer_cannot_cause_a_retry_storm(self) -> None:
        """Reconnect delay is capped regardless of attempt count, so retries never grow without bound."""
        self.assertLessEqual(_retry_delay(1_000), 31.0)


class FaultStaleAuthorityTests(unittest.TestCase):
    """Wrong or stale assignment, fence, generation, revision, and args are refused fail-closed."""

    def test_stale_generation_or_wrong_assignment_discards_the_local_checkpoint(self) -> None:
        """A checkpoint disagreeing on run, attempt, or input generation is discarded, never trusted."""
        with tempfile.TemporaryDirectory() as directory:
            cipher = _ReversingCipher()
            _write_checkpoint("run-fault", 2, 5, {"compiledInput": {}}, cipher=cipher, checkpoint_dir=directory)
            self.assertIsNone(_read_checkpoint("run-fault", 2, 6, cipher=cipher, checkpoint_dir=directory))
            self.assertIsNone(_read_checkpoint("other-run", 2, 5, cipher=cipher, checkpoint_dir=directory))
            self.assertIsNone(_read_checkpoint("run-fault", 3, 5, cipher=cipher, checkpoint_dir=directory))

    def test_forged_checkpoint_version_is_discarded(self) -> None:
        """A checkpoint tagged with an unknown version is discarded rather than replayed as state."""
        with tempfile.TemporaryDirectory() as directory:
            cipher = _ReversingCipher()
            path = _checkpoint_path(directory)
            forged = cipher.encrypt(json.dumps({"checkpointVersion": 404, "runId": "run-fault", "attempt": 2, "inputGeneration": 5, "state": {}}, sort_keys=True, separators=(",", ":")).encode("utf-8"))
            with open(path, "wb") as handle:
                handle.write(forged)
            self.assertIsNone(_read_checkpoint("run-fault", 2, 5, cipher=cipher, checkpoint_dir=directory))

    def test_ungranted_or_altered_tool_revision_is_a_hard_unknown_tool_error(self) -> None:
        """A tool naming a revision outside the compiled grant set is a hard error, never an action."""
        candidate = _tool_call_candidate(_coordinates(), _compiled_input(), {"type": "tool_call", "toolName": "exfiltrate", "toolCallId": "call-x", "arguments": "{}"})
        self.assertEqual(candidate["eventType"], "tool.failed")
        self.assertEqual(candidate["payload"], {"reason": "unknown_tool", "toolInvocationId": "call-x"})

    def test_changed_arguments_change_the_digest(self) -> None:
        """A single changed argument changes the digest so a mutated replay cannot reuse the authority row."""
        self.assertNotEqual(_arguments_digest({"q": "a"}), _arguments_digest({"q": "b"}))

    def test_malformed_frame_yields_no_coordinates_and_no_candidate(self) -> None:
        """A schema-mismatched frame (missing assignment) yields no coordinates, so no candidate posts."""
        emitted: list[dict] = []
        _execute_start_attempt({"kind": "start_attempt", "commandId": "cmd-bad", "fence": 4}, "instance-fault", emitted.append, event_source=lambda _c, _x, _s: iter([]))
        self.assertEqual(emitted, [])


class FaultOversizedPayloadTests(unittest.TestCase):
    """An oversized stream frame is rejected at the 64 KiB boundary rather than buffered unbounded."""

    def test_frame_above_the_boundary_is_rejected(self) -> None:
        """A single response line above 64 KiB raises rather than being parsed."""
        oversized = b"data: " + b"a" * (_MAX_FRAME_BYTES + 1) + b"\n"
        with self.assertRaises(RuntimeError):
            list(_iter_commands(iter([oversized]), threading.Event()))


class FaultCredentialLeakTests(unittest.TestCase):
    """No credential material ever reaches a candidate or a log line."""

    def test_run_evidence_and_candidates_never_carry_credential_material(self) -> None:
        """Across a full start run, neither emitted candidates nor logs contain a key or token."""
        emitted: list[dict] = []
        buffer = io.StringIO()
        import contextlib

        with contextlib.redirect_stdout(buffer):
            _execute_start_attempt(_start_command(), "instance-fault", emitted.append, event_source=lambda _c, _x, _s: iter([{"type": "usage", "inputTokens": 1, "outputTokens": 1}]))
        serialized = json.dumps(emitted) + buffer.getvalue()
        for secret_marker in ("sk-", "litellmKey", "Bearer ", "api_key", "privateKey"):
            self.assertNotIn(secret_marker, serialized)


if __name__ == "__main__":
    unittest.main()
