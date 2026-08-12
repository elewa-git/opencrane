"""Own the sole outbound command stream and its worker-thread hand-off.

The runtime has no listener. It opens one bearer-authenticated server-sent event (SSE) response,
parses bounded ``command`` frames, and keeps reading while start/resume work runs on a daemon thread.
That separation is essential: the reader must remain available to receive ``cancel_attempt`` while a
model request is in flight.
"""

import json
import threading
from collections.abc import Callable, Iterator
from urllib.request import Request, urlopen

from ..attempts.execution import (
    execute_cancel_attempt,
    execute_resume_attempt,
    execute_start_attempt,
)
from ..attempts.terminal import TerminalGate
from ..constants import MAX_FRAME_BYTES, PROTOCOL_VERSION
from ..observability import log, trace
from .http import post_candidate
from .output import publish_output_asset


class _AttemptWorkerRegistry:
    """Track every command worker until it exits and expose one current cancellation signal.

    The server should serialize commands for this attempt, but the runtime still defends itself
    against overlap. Activating a new start/resume worker cancels the prior current worker before the
    new one can emit. Completed workers remove themselves, while stream teardown cancels every worker
    still registered. The lock protects only the small in-memory registry; it is never held while
    model or network work runs.
    """

    def __init__(self) -> None:
        """Create an empty, process-local worker registry."""
        self._lock = threading.Lock()
        self._signals: set[threading.Event] = set()
        self._current: threading.Event | None = None

    def activate(self) -> threading.Event:
        """Cancel the worker this one replaces, then register the new worker's signal."""
        fresh = threading.Event()
        with self._lock:
            # Supersession is signalled before publishing the new current worker. This prevents a
            # concurrent cancel command from targeting the stale worker while the replacement starts.
            if self._current is not None:
                self._current.set()
            self._current = fresh
            self._signals.add(fresh)
        return fresh

    def current(self) -> threading.Event | None:
        """Return the most recently activated signal for a server ``cancel_attempt`` command."""
        with self._lock:
            return self._current

    def release(self, signal: threading.Event) -> None:
        """Forget a worker that has finished, leaving any newer worker registered."""
        with self._lock:
            self._signals.discard(signal)
            # An older worker may finish after its replacement became current. Identity comparison
            # keeps that late cleanup from clearing the replacement's cancellation handle.
            if self._current is signal:
                self._current = None

    def cancel_all(self) -> None:
        """Signal every still-running worker when the authority stream is lost."""
        with self._lock:
            # Snapshot under the lock, then signal outside it. ``Event.set`` is small today, but the
            # registry lock must never become coupled to worker shutdown or callback behavior.
            signals = tuple(self._signals)
            self._current = None
        for signal in signals:
            signal.set()


def _launch_attempt_worker(
    handler: Callable[..., None],
    command: object,
    runtime_instance_id: str,
    control_plane_url: str,
    token: str,
    workers: _AttemptWorkerRegistry,
) -> None:
    """Start one start/resume handler on its own thread with its cancellation signal, and keep it registered until it exits."""
    # Every start/resume gets fresh local gates even when it supersedes work for the same run. The
    # command fence, not a reusable process-global event, defines which output may still be emitted.
    cancel_event = workers.activate()
    terminal_gate = TerminalGate(cancel_event)

    def _post_candidate(candidate: dict[str, object]) -> None:
        """Post a stable candidate once; the server owns all durable preparation retries."""
        # Capture this stream's URL and token in the worker closure. Candidates must never migrate to
        # a later reconnected stream whose bootstrap or fence may differ.
        post_candidate(
            control_plane_url,
            token,
            candidate,
        )

    def _publish_output(coordinates: dict[str, object], message_id: str, output: dict[str, object]) -> None:
        """Broker one exact generated output through the same projected runtime identity."""
        content = output.get("content")
        byte_length = len(content) if isinstance(content, bytes) else 0
        with trace("agent_runtime.output.publish", runId=coordinates.get("runId"), attempt=coordinates.get("attempt"), byteLength=byte_length):
            publish_output_asset(control_plane_url, token, coordinates, message_id, output)

    def _run() -> None:
        """Run the injected handler and release its signal even after an unexpected exception."""
        try:
            handler(
                command,
                runtime_instance_id,
                _post_candidate,
                cancel_event=cancel_event,
                terminal_gate=terminal_gate,
                publish_output=_publish_output,
            )
        finally:
            workers.release(cancel_event)

    # A daemon worker cannot keep an otherwise terminated runtime alive. The registry still signals
    # normal teardown so cooperative model work stops before the process exits.
    worker = threading.Thread(target=_run, daemon=True)
    try:
        worker.start()
    except BaseException:
        # Thread creation failure leaves no worker to release its registration.
        workers.release(cancel_event)
        raise


def iter_commands(response: object, cancelled: threading.Event) -> Iterator[object]:
    """Yield JSON values from bounded SSE events named ``command``.

    Frame size is checked before decoding to prevent an untrusted peer from forcing unbounded line
    buffering. Non-command SSE events are ignored. JSON errors propagate and tear down the stream;
    dispatch never guesses how to repair malformed control-plane data.
    """
    current_event = ""
    for raw_line in response:
        if cancelled.is_set():
            break
        if len(raw_line) > MAX_FRAME_BYTES:
            raise RuntimeError("runtime stream frame exceeds the 64KiB boundary")
        # Decode only after enforcing the byte bound. Replacement decoding is limited to the event
        # name; command JSON remains strict UTF-8 through ``json.loads`` and fails closed if malformed.
        line = raw_line.rstrip(b"\n")
        if line.startswith(b"event: "):
            # SSE associates subsequent data lines with the most recently declared event name.
            current_event = line[len(b"event: ") :].decode("utf-8", "replace")
        elif line.startswith(b"data: ") and current_event == "command":
            # The server contract uses one JSON value per data line. We do not concatenate arbitrary
            # multi-line SSE payloads because that would weaken the per-frame size boundary.
            yield json.loads(line[len(b"data: ") :].decode("utf-8"))
        elif line == b"":
            # A blank line terminates the current SSE event; do not let its type bleed into the next
            # data block.
            current_event = ""


def open_stream(
    control_plane_url: str,
    token: str,
    runtime_instance_id: str,
    pod_uid: str,
    handle_start: Callable[..., None] = execute_start_attempt,
    handle_resume: Callable[..., None] = execute_resume_attempt,
    handle_cancel: Callable[..., None] = execute_cancel_attempt,
) -> int:
    """Open one authenticated stream and dispatch its supported command kinds.

    Start and resume handlers receive a fresh cancellation event and terminal gate. Candidate-post
    closures bind delivery to that same event. Cancel runs on the reader thread so it can signal the
    worker immediately. Injected handlers are test seams; production uses the attempt package.

    Returns:
        Zero after the response closes normally. Network and protocol failures propagate so
        ``runtime.py`` can apply bounded reconnect policy.
    """
    # The open body binds this connection to both the process instance and the exact Kubernetes Pod
    # identity admitted by the server-side runtime stream.
    # Opening the stream is itself an authenticated admission request, not a passive subscription.
    # The server checks these coordinates alongside the projected bearer token before sending work.
    body = json.dumps(
        {
            "protocolVersion": PROTOCOL_VERSION,
            "runtimeInstanceId": runtime_instance_id,
            "podUid": pod_uid,
        },
    ).encode("utf-8")
    request = Request(
        f"{control_plane_url.rstrip('/')}/stream",
        data=body,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
        },
        method="POST",
    )
    # One loss signal covers both the reader and workers created by this response. A reconnect builds
    # a new registry rather than allowing old workers to emit through a new authority channel.
    stream_lost = threading.Event()
    workers = _AttemptWorkerRegistry()

    try:
        with urlopen(request, timeout=45) as response:
            if response.status != 200:
                raise RuntimeError(f"runtime stream returned unexpected status {response.status}")
            log("stream_connected", runtime_instance_id=runtime_instance_id)
            for command in iter_commands(response, stream_lost):
                if stream_lost.is_set():
                    break
                # The server contract emits command objects. Structural coordinate validation still
                # happens inside the attempt handler before any candidate can be produced.
                kind = command.get("kind")
                if kind == "start_attempt":
                    # The command reader stays free while the model loop owns this worker's signal
                    # and single terminal writer.
                    _launch_attempt_worker(
                        handle_start,
                        command,
                        runtime_instance_id,
                        control_plane_url,
                        token,
                        workers,
                    )
                elif kind == "resume_attempt":
                    # Resume receives a new command/fence and therefore a fresh local worker gate.
                    _launch_attempt_worker(
                        handle_resume,
                        command,
                        runtime_instance_id,
                        control_plane_url,
                        token,
                        workers,
                    )
                elif kind == "cancel_attempt":
                    # Cancellation must not wait behind model execution; signal the active worker on
                    # the stream-reader thread.
                    handle_cancel(
                        command,
                        runtime_instance_id,
                        cancel_event=workers.current(),
                    )
                else:
                    # Forward compatibility is fail-closed: an unknown command cannot acquire model,
                    # cancellation, or candidate-emission behavior by falling through a default path.
                    continue
                log(
                    "command_dispatched",
                    runtime_instance_id=runtime_instance_id,
                    command_kind=kind,
                )
    finally:
        # A dropped stream is equivalent to losing the authority channel. Stop both frame parsing and
        # every registered model worker so none can continue emitting against a dead fence.
        stream_lost.set()
        workers.cancel_all()
    return 0
