"""Orchestrate fenced attempt commands across model, protocol, and transport seams.

This module owns per-command control flow, not durable run authority. It validates enough structure
to bind candidates, starts or resumes the neutral model-event source, projects each event through the
protocol seam, and asks ``TerminalGate`` to deliver one local completion/failure. Cancellation only
signals local work to stop; the server owns the canonical cancelled state.
"""

import threading
from collections.abc import Callable, Iterable
from urllib.error import HTTPError, URLError

from ..model_loop.checkpoints import read_checkpoint, write_checkpoint
from ..model_loop.driver import pydantic_ai_event_source, pydantic_ai_resume_source
from ..observability import log, run_evidence, trace
from ..protocol.candidates import (
    candidate,
    command_coordinates,
)
from ..protocol.event_projector import RuntimeEventProjector
from .deferred_results import resolve_deferred_tool_results
from .pending_tools import record_pending_tool_call
from .terminal import TerminalGate


def execute_start_attempt(
    command: dict[str, object],
    runtime_instance_id: str,
    post_candidate: Callable[[dict[str, object]], None],
    event_source: Callable[..., Iterable[dict[str, object]]] = pydantic_ai_event_source,
    cancel_event: threading.Event | None = None,
    checkpoint_cipher: object | None = None,
    terminal_gate: "TerminalGate | None" = None,
) -> None:
    """Execute one admitted ``start_attempt`` command.

    Sequence: derive trusted coordinates, validate compiled input, emit ``run.started``, write a
    best-effort checkpoint, stream neutral model events, then claim ``run.completed``. Expected
    executor/transport failures become one ``run.failed`` terminal candidate unless cancellation has
    already suppressed local terminal delivery.
    """
    coordinates = command_coordinates(command, runtime_instance_id)
    if coordinates is None:
        # Without accepted coordinates even an error candidate would be unauthorised and ambiguous.
        return
    cancel_event = cancel_event or threading.Event()
    terminal_gate = terminal_gate or TerminalGate(cancel_event)
    payload = command.get("payload")
    compiled_input = payload.get("compiledInput") if isinstance(payload, dict) else None
    if not isinstance(compiled_input, dict):
        # The command is coordinate-valid, so this structural failure can be reported against the
        # exact accepted command rather than disappearing as an uncorrelated process error.
        terminal_gate.post_completion(
            post_candidate,
            candidate(coordinates, "run.failed", {"reason": "missing_compiled_input"}),
        )
        return
    post_candidate(
        candidate(
            coordinates,
            "run.started",
            {"promptCompilerVersion": compiled_input.get("promptCompilerVersion")},
        ),
    )
    run_evidence(coordinates, "started")
    _try_write_checkpoint(
        coordinates,
        payload if isinstance(payload, dict) else {},
        compiled_input,
        checkpoint_cipher,
    )
    steering_buffer: list[str] = []
    projector = RuntimeEventProjector(coordinates, compiled_input, post_candidate, record_pending_tool_call)
    with trace(
        "agent_runtime.start_attempt",
        runId=coordinates["runId"],
        attempt=coordinates["attempt"],
    ):
        try:
            for neutral_event in event_source(compiled_input, cancel_event, steering_buffer):
                if cancel_event.is_set():
                    # Cancellation is checked again after the source yields so a racing provider
                    # response cannot become a late candidate.
                    break
                projector.emit(neutral_event)
            if not cancel_event.is_set():
                projector.complete_message()
            if terminal_gate.post_completion(
                post_candidate,
                candidate(coordinates, "run.completed", {}),
            ):
                run_evidence(coordinates, "completed")
        except (HTTPError, URLError, OSError, RuntimeError, ValueError) as error:
            # Report only the exception type. Messages may contain provider URLs, content, or other
            # data that does not belong in a candidate or structured log.
            if terminal_gate.post_completion(
                post_candidate,
                candidate(
                    coordinates,
                    "run.failed",
                    {"reason": "executor_failed", "errorType": type(error).__name__},
                ),
            ):
                run_evidence(
                    coordinates,
                    "error",
                    reason="executor_failed",
                    errorType=type(error).__name__,
                )


def execute_resume_attempt(
    command: dict[str, object],
    runtime_instance_id: str,
    post_candidate: Callable[[dict[str, object]], None],
    resume_event_source: Callable[..., Iterable[dict[str, object]]] = pydantic_ai_resume_source,
    cancel_event: threading.Event | None = None,
    checkpoint_cipher: object | None = None,
    terminal_gate: "TerminalGate | None" = None,
) -> None:
    """Execute one admitted ``resume_attempt`` with authorised deferred results.

    Resume never decides whether an action was approved. It accepts the server's input generation,
    deferred tool results, and steering requests; recovers only coordinate-matching compiled context;
    then runs the same neutral-event and terminal pipeline as a fresh start.
    """
    coordinates = command_coordinates(command, runtime_instance_id)
    if coordinates is None:
        return
    cancel_event = cancel_event or threading.Event()
    terminal_gate = terminal_gate or TerminalGate(cancel_event)
    payload = command.get("payload")
    if not isinstance(payload, dict):
        terminal_gate.post_completion(
            post_candidate,
            candidate(coordinates, "run.failed", {"reason": "missing_resume_payload"}),
        )
        return
    input_generation = payload.get("inputGeneration")
    deferred_tool_results = payload.get("deferredToolResults")
    steering_requests = payload.get("steeringRequests")
    if (
        not isinstance(steering_requests, list)
        or any(
            not isinstance(item, dict)
            or not isinstance(item.get("text"), str)
            or not item["text"].strip()
            for item in steering_requests
        )
    ):
        # Steering is literal user/control-plane input. Reject empty or structurally ambiguous items
        # rather than trying to repair them inside the model adapter.
        terminal_gate.post_completion(
            post_candidate,
            candidate(coordinates, "run.failed", {"reason": "invalid_resume_steering"}),
        )
        return
    compiled_input = _recover_compiled_input(
        coordinates,
        input_generation,
        checkpoint_cipher,
    )
    post_candidate(
        candidate(
            coordinates,
            "run.resumed",
            {"inputGeneration": input_generation},
        ),
    )
    run_evidence(coordinates, "resumed", inputGeneration=input_generation)
    # Approval decisions name WHICH proposed calls were approved; the runtime executes each approved
    # call directly against Obot here and feeds the framework only the resulting per-call mapping.
    deferred_tool_results = resolve_deferred_tool_results(
        coordinates,
        compiled_input,
        deferred_tool_results,
        post_candidate,
    )
    steering_buffer = [item["text"].strip() for item in steering_requests]
    projector = RuntimeEventProjector(coordinates, compiled_input, post_candidate, record_pending_tool_call)
    with trace(
        "agent_runtime.resume_attempt",
        runId=coordinates["runId"],
        attempt=coordinates["attempt"],
    ):
        try:
            for neutral_event in resume_event_source(
                compiled_input,
                deferred_tool_results,
                cancel_event,
                steering_buffer,
            ):
                if cancel_event.is_set():
                    # A resume is subject to the same late-output suppression as a fresh attempt.
                    break
                projector.emit(neutral_event)
            if not cancel_event.is_set():
                projector.complete_message()
            if terminal_gate.post_completion(
                post_candidate,
                candidate(coordinates, "run.completed", {}),
            ):
                run_evidence(coordinates, "completed")
        except (HTTPError, URLError, OSError, RuntimeError, ValueError) as error:
            if terminal_gate.post_completion(
                post_candidate,
                candidate(
                    coordinates,
                    "run.failed",
                    {"reason": "executor_failed", "errorType": type(error).__name__},
                ),
            ):
                run_evidence(
                    coordinates,
                    "error",
                    reason="executor_failed",
                    errorType=type(error).__name__,
                )


def execute_cancel_attempt(
    command: dict[str, object],
    runtime_instance_id: str,
    cancel_event: threading.Event | None = None,
) -> None:
    """Stop local work for a valid ``cancel_attempt`` and record safe evidence.

    No runtime terminal candidate is emitted: receiving the command means the server has already
    chosen the canonical cancellation transition. Invalid coordinates do nothing because they cannot
    be tied to the active admitted attempt.
    """
    coordinates = command_coordinates(command, runtime_instance_id)
    if coordinates is None:
        return
    if cancel_event is not None:
        # Set the shared event before recording evidence so the worker observes cancellation as soon
        # as possible and cannot race a late completion through the terminal gate.
        cancel_event.set()
    payload = command.get("payload")
    reason = payload.get("reason") if isinstance(payload, dict) else None
    run_evidence(coordinates, "cancelled", reason=reason)


def _snapshot_input_generation(payload: dict[str, object]) -> object:
    """Read the accepted input generation, defaulting legacy/malformed absence to zero."""
    snapshot = payload.get("snapshot") if isinstance(payload, dict) else None
    if isinstance(snapshot, dict) and isinstance(snapshot.get("inputGeneration"), int):
        return snapshot["inputGeneration"]
    return 0


def _try_write_checkpoint(
    coordinates: dict[str, object],
    payload: dict[str, object],
    compiled_input: dict[str, object],
    cipher: object | None,
) -> None:
    """Best-effort persist compiled context without making checkpointing load-bearing.

    Any local crypto or filesystem failure is reduced to safe evidence. The active model attempt
    continues because server authority and emitted candidates do not depend on local scratch.
    """
    try:
        write_checkpoint(
            coordinates["runId"],
            coordinates["attempt"],
            _snapshot_input_generation(payload),
            {"compiledInput": compiled_input},
            cipher=cipher,
        )
    except Exception:  # noqa: BLE001 - checkpoints never become load-bearing
        log(
            "checkpoint_skipped",
            runId=coordinates.get("runId"),
            attempt=coordinates.get("attempt"),
        )


def _recover_compiled_input(
    coordinates: dict[str, object],
    input_generation: object,
    cipher: object | None,
) -> dict[str, object]:
    """Recover compiled context only from a coordinate-matching subordinate checkpoint.

    An empty mapping is deliberately fail-closed: any subsequent tool call resolves as unknown
    rather than inheriting a stale or unverifiable grant set.
    """
    try:
        state = read_checkpoint(
            coordinates["runId"],
            coordinates["attempt"],
            input_generation,
            cipher=cipher,
        )
    except Exception:  # noqa: BLE001 - checkpoints never crash resume
        return {}
    if isinstance(state, dict) and isinstance(state.get("compiledInput"), dict):
        return state["compiledInput"]
    return {}
