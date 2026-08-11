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
from ..model_loop.histories import clear_model_history
from ..observability import log, run_evidence, trace
from ..protocol.candidates import (
    candidate,
    command_coordinates,
)
from ..protocol.event_projector import RuntimeEventProjector
from .tool_results import resolve_tool_results
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
    publish_output: Callable[[dict[str, object], str, dict[str, object]], None] | None = None,
) -> None:
    """Execute one admitted ``start_attempt`` command.

    Sequence: derive trusted coordinates, validate compiled input, emit ``run.started``, write a
    best-effort checkpoint, stream neutral model events, then claim ``run.completed``. Expected
    executor/transport failures become one ``run.failed`` terminal candidate unless cancellation has
    already suppressed local terminal delivery.
    """
    # Coordinates are the runtime's capability fence for this command. Resolve them before reading
    # payload data so unbound input can neither start model work nor elicit a candidate.
    coordinates = command_coordinates(command, runtime_instance_id)
    if coordinates is None:
        # Without accepted coordinates even an error candidate would be unauthorised and ambiguous.
        return
    # The executor and terminal gate must share one signal. Otherwise cancellation could stop model
    # iteration while a separately constructed gate still publishes completion.
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
    if not _compiled_input_matches_coordinates(compiled_input, coordinates):
        terminal_gate.post_completion(
            post_candidate,
            candidate(coordinates, "run.failed", {"reason": "compiled_input_coordinate_mismatch"}),
        )
        return
    # Announce the attempt before touching the model adapter. This keeps the candidate stream ordered
    # even when model construction fails immediately after admission.
    post_candidate(
        candidate(
            coordinates,
            "run.started",
            {"promptCompilerVersion": compiled_input.get("promptCompilerVersion")},
        ),
    )
    run_evidence(coordinates, "started")
    # Checkpoint only after ``run.started``: local recovery state must never suggest that an attempt
    # began before the server has seen the corresponding lifecycle candidate.
    _try_write_checkpoint(
        coordinates,
        payload if isinstance(payload, dict) else {},
        compiled_input,
        checkpoint_cipher,
    )
    # A fresh start has no carried steering. The mutable list is intentionally attempt-local and is
    # drained only by the model adapter at pre-request boundaries.
    steering_buffer: list[str] = []
    # Projection is the protocol firewall: execution observes neutral events, while the projector
    # alone binds them to canonical candidate kinds, command coordinates, and frozen tool grants.
    projector = RuntimeEventProjector(coordinates, compiled_input, post_candidate, record_pending_tool_call, publish_output)
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
            if cancel_event.is_set():
                clear_model_history(str(coordinates["runId"]), int(coordinates["attempt"]))
                return
            projector.complete_message()
            if projector.has_pending_tool_calls:
                # A tool proposal pauses the model loop. Completion belongs after the control plane
                # authorises and returns the saved result through a later resume command.
                return
            clear_model_history(str(coordinates["runId"]), int(coordinates["attempt"]))
            if terminal_gate.post_completion(
                post_candidate,
                candidate(coordinates, "run.completed", {}),
            ):
                run_evidence(coordinates, "completed")
        except (HTTPError, URLError, OSError, RuntimeError, ValueError) as error:
            # Report only the exception type. Messages may contain provider URLs, content, or other
            # data that does not belong in a candidate or structured log.
            clear_model_history(str(coordinates["runId"]), int(coordinates["attempt"]))
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
    publish_output: Callable[[dict[str, object], str, dict[str, object]], None] | None = None,
) -> None:
    """Execute one admitted ``resume_attempt`` with saved tool results.

    Resume never executes an external action. It accepts the server's input generation, exact saved
    tool results, and steering requests; recovers only coordinate-matching compiled context;
    then runs the same neutral-event and terminal pipeline as a fresh start.
    """
    # A resume is not permission inferred from a run id. It is a separately fenced command, and all
    # recovered local state remains subordinate to these newly accepted coordinates.
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
    # Input generation prevents an otherwise matching run/attempt checkpoint from reviving context
    # compiled before later steering or control-plane input was accepted.
    input_generation = payload.get("inputGeneration")
    tool_results = payload.get("toolResults")
    steering_requests = payload.get("steeringRequests")
    if not isinstance(tool_results, list):
        terminal_gate.post_completion(
            post_candidate,
            candidate(coordinates, "run.failed", {"reason": "invalid_tool_results"}),
        )
        return
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
    # Recover context before consuming pending calls, but treat missing local scratch as an empty,
    # fail-closed grant set rather than asking the runtime to reconstruct authority.
    compiled_input = _recover_compiled_input(
        coordinates,
        input_generation,
        checkpoint_cipher,
    )
    if compiled_input and not _compiled_input_matches_coordinates(compiled_input, coordinates):
        clear_model_history(str(coordinates["runId"]), int(coordinates["attempt"]))
        terminal_gate.post_completion(
            post_candidate,
            candidate(coordinates, "run.failed", {"reason": "compiled_input_coordinate_mismatch"}),
        )
        return
    # The control plane already executed or refused each call and persisted its terminal result.
    # The runtime only maps those exact results into the model framework.
    # Resolution atomically consumes the pending calls named by this command. This must precede
    # announcing ``run.resumed`` so an unknown, duplicated, or replayed result cannot masquerade as
    # accepted continuation; other pending calls may remain for a later resume.
    resolved_tool_results = resolve_tool_results(
        coordinates,
        tool_results,
        post_candidate,
    )
    if resolved_tool_results is None:
        terminal_gate.post_completion(
            post_candidate,
            candidate(coordinates, "run.failed", {"reason": "invalid_tool_results"}),
        )
        return
    # At this point coordinates, resume structure, and the supplied pending-call identities have
    # passed. Checkpoint recovery may still have produced empty context; only now is the accepted
    # resume command visible in the candidate timeline.
    post_candidate(
        candidate(
            coordinates,
            "run.resumed",
            {"inputGeneration": input_generation},
        ),
    )
    run_evidence(coordinates, "resumed", inputGeneration=input_generation)
    # Preserve control-plane order while normalising only surrounding whitespace already validated
    # above. The runtime does not merge, rank, or reinterpret steering content.
    steering_buffer = [item["text"].strip() for item in steering_requests]
    # Construct a new projector for this command: message lifecycle and candidate identifiers are
    # command-scoped, even though the model context continues the same durable run attempt.
    projector = RuntimeEventProjector(coordinates, compiled_input, post_candidate, record_pending_tool_call, publish_output)
    with trace(
        "agent_runtime.resume_attempt",
        runId=coordinates["runId"],
        attempt=coordinates["attempt"],
    ):
        try:
            for neutral_event in resume_event_source(
                compiled_input,
                resolved_tool_results,
                cancel_event,
                steering_buffer,
            ):
                if cancel_event.is_set():
                    # A resume is subject to the same late-output suppression as a fresh attempt.
                    break
                projector.emit(neutral_event)
            if cancel_event.is_set():
                clear_model_history(str(coordinates["runId"]), int(coordinates["attempt"]))
                return
            projector.complete_message()
            if projector.has_pending_tool_calls:
                # Additional tool calls create another control-plane round trip; a resume may pause
                # repeatedly, and none of those intermediate pauses is a completed run.
                return
            clear_model_history(str(coordinates["runId"]), int(coordinates["attempt"]))
            if terminal_gate.post_completion(
                post_candidate,
                candidate(coordinates, "run.completed", {}),
            ):
                run_evidence(coordinates, "completed")
        except (HTTPError, URLError, OSError, RuntimeError, ValueError) as error:
            clear_model_history(str(coordinates["runId"]), int(coordinates["attempt"]))
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
    clear_model_history(str(coordinates["runId"]), int(coordinates["attempt"]))
    # The reason is evidence only. It cannot alter cancellation semantics or select a different local
    # worker, because command routing already paired this signal with the active attempt.
    payload = command.get("payload")
    reason = payload.get("reason") if isinstance(payload, dict) else None
    run_evidence(coordinates, "cancelled", reason=reason)


def _snapshot_input_generation(payload: dict[str, object]) -> object:
    """Read the accepted input generation, using zero when it is missing or malformed (older commands included)."""
    # Generation is copied from the server snapshot rather than derived locally, preserving the
    # control plane's ordering across accepted input changes.
    snapshot = payload.get("snapshot") if isinstance(payload, dict) else None
    if isinstance(snapshot, dict) and isinstance(snapshot.get("inputGeneration"), int):
        return snapshot["inputGeneration"]
    return 0


def _compiled_input_matches_coordinates(
    compiled_input: dict[str, object],
    coordinates: dict[str, object],
) -> bool:
    """Require the sealed compiler coordinates to match the admitted command exactly."""
    return (
        compiled_input.get("runId") == coordinates.get("runId")
        and compiled_input.get("attempt") == coordinates.get("attempt")
    )


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
    # Checkpoint failure is intentionally outside the model-loop failure path. Local scratch improves
    # continuation only; it cannot veto execution of an otherwise admitted command.
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
    # Decrypt and validate through the checkpoint owner rather than reading the file here. Keeping a
    # single validation point prevents resume code from accidentally accepting weaker coordinates.
    try:
        state = read_checkpoint(
            coordinates["runId"],
            coordinates["attempt"],
            input_generation,
            cipher=cipher,
        )
    except Exception:  # noqa: BLE001 - checkpoints never crash resume
        return {}
    # Return only the one state member execution understands. Other checkpoint fields, including any
    # introduced by a future format, cannot silently become model input.
    if isinstance(state, dict) and isinstance(state.get("compiledInput"), dict):
        return state["compiledInput"]
    return {}
