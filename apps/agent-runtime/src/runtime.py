"""Outbound-only OpenCrane personal-agent runtime.

This process performs its one-use bootstrap exchange, then opens a single authenticated command
stream to OpenCrane and executes the ``start_attempt``, ``resume_attempt``, and ``cancel_attempt``
commands it receives. Execution is a bounded Pydantic AI model/tool loop over the per-silo LiteLLM
proxy, reached only through an attempt-scoped virtual key mounted as a group-readable Secret; the
runtime holds no master key, no provider secret, and no database. Raw framework events are normalized
into stable protocol candidates while the attempt is active; Pydantic AI types, ids, and checkpoints
never cross that seam.

Current capability: a model-proposed tool call is surfaced as a bounded ``external_action`` candidate
(its ``toolRevisionId`` resolved from the compiled grant set, its ``argumentsDigest`` computed
deterministically) for the control plane to authorize — the runtime never executes the tool itself.
Resume feeds control-plane-authorized deferred tool results back into the paused loop; cancel is a
positive signal that kills the active task and acknowledges the server-chosen reason. Steering is
absorbed only at pre-model-request boundaries, and an encrypted, version-tagged, replaceable local
checkpoint is written to the per-attempt scratch as a resume optimisation subordinate to canonical
server state. Because the loop is configured with zero implicit retries, any executor failure
surfaces as a real ``run.error`` candidate rather than a silent acknowledgement.

Phase E slice 4 lands the offline conformance harness and fault-injection matrix that exercise this
shell against independently authored neutral-event fixtures and a LiteLLM-compatible test double; both
run in CI with no network (``tests/test_conformance.py`` and ``tests/test_fault_matrix.py``). The
live-LiteLLM conformance leg, the adoption evidence for the pinned Pydantic AI package (ADR 0010), and
the corresponding OpenClaw loop deletion remain gated on #337 and are not exercised by this offline
slice.
"""

import asyncio
import base64
import contextlib
import hashlib
import json
import os
import random
import sys
import threading
import time
import uuid
from typing import Callable, Iterable, Iterator
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


_PROTOCOL_VERSION = "opencrane.agent-runtime/v1"
_DEFAULT_TOKEN_PATH = "/var/run/opencrane/tokens/runtime.token"
_DEFAULT_BOOTSTRAP_PATH = "/var/run/opencrane/bootstrap/reference"
_DEFAULT_LITELLM_KEY_PATH = "/var/run/opencrane/litellm/key"
_DEFAULT_CHECKPOINT_DIR = "/tmp/opencrane/checkpoints"
_CHECKPOINT_VERSION = 1
_CHECKPOINT_FILENAME = "checkpoint.enc"
_MAX_FRAME_BYTES = 65_536
_MAX_CANDIDATE_RETRY_DELAY_SECONDS = 30.0

# Process-lifetime symmetric cipher for local checkpoints. It is generated in memory at first use and
# never written, logged, or exported; a restarted process cannot read a prior process's checkpoint,
# which is correct because the checkpoint is a per-attempt scratch optimisation, never durable state.
_PROCESS_CIPHER: object | None = None


class BootstrapDeniedError(RuntimeError):
    """Raised when the control plane refuses the one-use bootstrap; the run must not proceed."""


def _environment(name: str, default: str | None = None) -> str:
    """Read a required runtime setting without echoing its possibly sensitive value."""
    value = os.environ.get(name, default)
    if not value:
        raise RuntimeError(f"{name} must be configured")
    return value


def _log(event: str, **fields: object) -> None:
    """Emit one safe structured log line; callers must never pass credentials."""
    print(json.dumps({"component": "agent-runtime", "event": event, **fields}, sort_keys=True), flush=True)


@contextlib.contextmanager
def _trace(operation: str, **attributes: object):
    """Wrap one runtime operation in an OpenTelemetry span when the SDK is present, else a no-op.

    ``opentelemetry`` is imported lazily so the outbound shell and its offline tests never require the
    package; when it is absent (this offline slice) the block is a transparent no-op while the
    structured wide-event logs still carry the run/attempt evidence. Attributes carry only non-secret
    run coordinates — never a token, key, or model content. Real OTLP export to the in-cluster
    collector is part of the #337 live/adoption wiring, mirroring ``@opencrane/observability`` on the
    TypeScript control plane.
    """
    try:
        from opentelemetry import trace
    except ImportError:
        yield None
        return
    tracer = trace.get_tracer("agent-runtime")
    with tracer.start_as_current_span(operation) as span:
        for key, value in attributes.items():
            span.set_attribute(key, value)
        yield span


def _run_evidence(coordinates: dict[str, object], outcome: str, **fields: object) -> None:
    """Emit one durable wide run-evidence event bound to the run and attempt for observability.

    It carries only the run/attempt/command correlation and the terminal outcome; credentials, tokens,
    keys, and model content are never included, so the event is safe to route to durable log storage.
    """
    _log("run_evidence", runId=coordinates.get("runId"), attempt=coordinates.get("attempt"), commandId=coordinates.get("commandId"), runtimeInstanceId=coordinates.get("runtimeInstanceId"), outcome=outcome, **fields)


def _read_projected_token(token_path: str) -> str:
    """Read the short-lived projected token only at connection time."""
    with open(token_path, "r", encoding="utf-8") as token_file:
        token = token_file.read().strip()
    if not token:
        raise RuntimeError("projected runtime token is empty")
    return token


def _read_bootstrap_reference(bootstrap_path: str) -> str:
    """Read the opaque, non-secret bootstrap reference projected into the Pod."""
    with open(bootstrap_path, "r", encoding="utf-8") as reference_file:
        reference = reference_file.read().strip()
    if not reference:
        raise RuntimeError("projected bootstrap reference is empty")
    return reference


def _read_attempt_litellm_key(key_path: str) -> str:
    """Read the attempt-scoped LiteLLM virtual key from its mounted, group-readable Secret volume.

    The key is the runtime's only route to a model. It is read at execution time, never logged, and
    never placed in a shared or persistent location. A missing or empty file raises so the failure
    surfaces as a real ``run.error`` candidate rather than a silent success.
    """
    with open(key_path, "r", encoding="utf-8") as key_file:
        key = key_file.read().strip()
    if not key:
        raise RuntimeError("attempt-scoped LiteLLM key is empty")
    return key


def _base64url(raw: bytes) -> str:
    """Encode bytes as unpadded base64url, the encoding used by JOSE and RFC 7638."""
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _rfc7638_thumbprint(x_coordinate: str, y_coordinate: str) -> str:
    """Compute the RFC 7638 thumbprint of a P-256 public key from its base64url coordinates.

    The canonical member order for an EC key is exactly ``crv``, ``kty``, ``x``, ``y`` with no
    whitespace, so two runtimes deriving a thumbprint for the same key always agree with the server.
    """
    canonical = json.dumps({"crv": "P-256", "kty": "EC", "x": x_coordinate, "y": y_coordinate}, separators=(",", ":"), sort_keys=False)
    return _base64url(hashlib.sha256(canonical.encode("utf-8")).digest())


def _generate_proof_key() -> dict[str, object]:
    """Generate one per-run ES256 keypair and return its public JWK, thumbprint, and private key.

    The private key is retained only in memory for the process lifetime; the public half is bound to
    the run by the bootstrap exchange so the bound key can sign capability proofs for external-action
    authorization. It is never written to disk, logged, or sent anywhere but as the public JWK in the
    bootstrap claim.
    """
    from cryptography.hazmat.primitives.asymmetric import ec

    private_key = ec.generate_private_key(ec.SECP256R1())
    numbers = private_key.public_key().public_numbers()
    x_coordinate = _base64url(numbers.x.to_bytes(32, "big"))
    y_coordinate = _base64url(numbers.y.to_bytes(32, "big"))
    public_jwk = {"kty": "EC", "crv": "P-256", "x": x_coordinate, "y": y_coordinate}
    return {"privateKey": private_key, "publicJwk": public_jwk, "thumbprint": _rfc7638_thumbprint(x_coordinate, y_coordinate)}


def _post_json(url: str, token: str, body: dict[str, object], timeout: float) -> int:
    """POST one bounded JSON body with the projected bearer token and return the HTTP status."""
    request = Request(url, data=json.dumps(body).encode("utf-8"), headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json", "Accept": "application/json"}, method="POST")
    with urlopen(request, timeout=timeout) as response:
        return response.status


def _retryable_candidate_delay(error: HTTPError) -> float | None:
    """Read one bounded retry delay from the explicit pre-reservation dispatch response.

    Only the runtime transport's ``503`` result with an exact ``retryable`` JSON body may trigger a
    same-candidate retry. Other HTTP failures remain ordinary protocol failures; this prevents a
    rejected or malformed action from being retried as if it had no durable invocation receipt.
    """
    if error.code != 503:
        return None
    try:
        payload = json.loads(error.read().decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None
    finally:
        error.close()
    if not isinstance(payload, dict) or payload.get("accepted") is not False or payload.get("retryable") is not True:
        return None
    delay_milliseconds = payload.get("retryAfterMilliseconds")
    if not isinstance(delay_milliseconds, int) or delay_milliseconds < 1 or delay_milliseconds > int(_MAX_CANDIDATE_RETRY_DELAY_SECONDS * 1_000):
        return None
    return delay_milliseconds / 1_000


def _post_candidate_with_retry(control_plane_url: str, token: str, candidate: dict[str, object], cancelled: threading.Event, post_json: Callable[[str, str, dict[str, object], float], int] = _post_json) -> None:
    """Post one candidate until accepted or stream cancellation after bounded retryable responses.

    A retry keeps the exact ``candidateId`` and action payload, so the durable admission fence treats
    every retry as one candidate rather than authoring a second external action. It only handles the
    server's explicit pre-reservation ``503`` response; a terminal denial, bad response, or transport
    failure still follows the existing fail-closed execution path. Each server-selected delay is
    bounded, and cancellation stops the retry loop without emitting a spurious ``run.error``.
    """
    while not cancelled.is_set():
        try:
            status = post_json(f"{control_plane_url.rstrip('/')}/candidates", token, candidate, 30)
            if 200 <= status < 300:
                return
            raise RuntimeError(f"candidate admission returned unexpected status {status}")
        except HTTPError as error:
            delay_seconds = _retryable_candidate_delay(error)
            if delay_seconds is None:
                raise
            _log("candidate_retry", runId=candidate.get("runId"), attempt=candidate.get("attempt"), candidateId=candidate.get("candidateId"), retry_in_seconds=delay_seconds)
            cancelled.wait(delay_seconds)


def _perform_bootstrap(control_plane_url: str, token: str, bootstrap_reference: str, proof_key: dict[str, object]) -> None:
    """Bind this run's public proof key exactly once, failing closed on any refusal.

    A 2xx confirms the single binding. A 4xx is a permanent refusal (already consumed, unknown, or
    mismatched) and must stop the run rather than retry, so a replayed bootstrap can never quietly
    succeed. A transport or 5xx error is raised unchanged so the caller can retry with backoff.
    """
    body = {"bootstrapReference": bootstrap_reference, "proofPublicJwk": proof_key["publicJwk"], "proofKeyThumbprint": proof_key["thumbprint"]}
    try:
        status = _post_json(f"{control_plane_url.rstrip('/')}/bootstrap", token, body, timeout=30)
    except HTTPError as error:
        if 400 <= error.code < 500:
            raise BootstrapDeniedError(f"bootstrap refused with status {error.code}") from error
        raise
    if status < 200 or status >= 300:
        raise BootstrapDeniedError(f"bootstrap returned unexpected status {status}")
    _log("bootstrap_bound", thumbprint=proof_key["thumbprint"])


def _command_coordinates(command: dict[str, object], runtime_instance_id: str) -> dict[str, object] | None:
    """Extract the immutable candidate coordinates carried by a received command.

    A candidate must echo the command's own runtime instance, command id, fence, run, and attempt so
    the control-plane authority can bind it back to the exact accepted command. A structurally invalid
    frame yields ``None`` rather than coordinates the authority would only reject.
    """
    assignment = command.get("assignment")
    command_id = command.get("commandId")
    fence = command.get("fence")
    if not isinstance(assignment, dict) or not isinstance(command_id, str) or not isinstance(fence, int):
        return None
    run_id = assignment.get("runId")
    attempt = assignment.get("attempt")
    if not isinstance(run_id, str) or not isinstance(attempt, int):
        return None
    return {"protocolVersion": _PROTOCOL_VERSION, "runtimeInstanceId": runtime_instance_id, "commandId": command_id, "runId": run_id, "attempt": attempt, "fence": fence}


def _candidate(coordinates: dict[str, object], event_type: str, payload: dict[str, object]) -> dict[str, object]:
    """Build one bounded ``event`` candidate from command coordinates, an event type, and a payload."""
    return {**coordinates, "candidateId": str(uuid.uuid4()), "kind": "event", "eventType": event_type, "payload": payload}


def _arguments_digest(arguments: object) -> str:
    """Compute the deterministic ``sha256:<hex>`` digest the control-plane authority re-derives.

    The arguments are serialized with sorted keys and no whitespace so the runtime and the TypeScript
    authority always agree on the digest of the same validated action arguments.
    """
    canonical = json.dumps(arguments, sort_keys=True, separators=(",", ":"))
    return "sha256:" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _external_action_candidate(coordinates: dict[str, object], tool_revision_id: str, tool_invocation_id: str, arguments_digest: str, arguments: object) -> dict[str, object]:
    """Build one bounded ``external_action`` candidate requesting deferred external authorization.

    The runtime never executes the tool: it surfaces the resolved tool revision, the model's
    invocation id, the deterministic arguments digest, and the arguments for the control plane to
    authorize and (later) execute. Tool grants come from the accepted snapshot, never from the model.
    """
    return {**coordinates, "candidateId": str(uuid.uuid4()), "kind": "external_action", "toolRevisionId": tool_revision_id, "toolInvocationId": tool_invocation_id, "argumentsDigest": arguments_digest, "arguments": arguments}


def _resolve_tool_revision(compiled_input: dict[str, object], tool_name: str) -> str | None:
    """Resolve a model tool name to its immutable revision from the compiled grant set.

    The compiled tools carry the authoritative ``name`` → ``toolRevisionId`` mapping fixed by the
    snapshot. A name absent from that set returns ``None`` so the caller emits an ``unknown_tool``
    error rather than an external action for an ungranted tool.
    """
    tools = compiled_input.get("tools")
    if not isinstance(tools, list):
        return None
    for tool in tools:
        if isinstance(tool, dict) and tool.get("name") == tool_name:
            revision = tool.get("toolRevisionId")
            return revision if isinstance(revision, str) else None
    return None


def _tool_call_candidate(coordinates: dict[str, object], compiled_input: dict[str, object], neutral_event: dict[str, object]) -> dict[str, object]:
    """Turn one model tool call into an ``external_action`` candidate or a hard ``run.error``.

    A malformed or unparseable tool call remains a ``run.error`` (``malformed_tool_call``); a tool
    naming a revision outside the compiled grant set is a hard ``run.error`` (``unknown_tool``) and
    never an external action. Otherwise the call becomes a bounded ``external_action`` candidate with
    the revision resolved from the snapshot's grants and a deterministic arguments digest.
    """
    tool_name = neutral_event.get("toolName")
    tool_call_id = neutral_event.get("toolCallId")
    raw_arguments = neutral_event.get("arguments")
    if not isinstance(tool_name, str) or not isinstance(tool_call_id, str) or not isinstance(raw_arguments, str):
        return _candidate(coordinates, "run.error", {"reason": "malformed_tool_call"})
    try:
        arguments = json.loads(raw_arguments)
    except json.JSONDecodeError:
        return _candidate(coordinates, "run.error", {"reason": "malformed_tool_call", "toolCallId": tool_call_id})
    tool_revision_id = _resolve_tool_revision(compiled_input, tool_name)
    if tool_revision_id is None:
        return _candidate(coordinates, "run.error", {"reason": "unknown_tool", "toolCallId": tool_call_id})
    return _external_action_candidate(coordinates, tool_revision_id, tool_call_id, _arguments_digest(arguments), arguments)


def _normalize_event(neutral_event: dict[str, object]) -> tuple[str, dict[str, object]] | None:
    """Normalize one non-tool neutral framework event into a stable protocol event type and payload.

    The neutral event is the adapter seam: the model driver translates Pydantic AI's own event
    objects into these plain dicts, so no framework type, id, or checkpoint crosses into a candidate.
    Tool calls are handled separately by ``_tool_call_candidate`` (they become ``external_action``
    candidates, never ``event`` candidates); this function covers output text, usage, and errors.
    """
    kind = neutral_event.get("type")
    if kind == "output_text":
        text = neutral_event.get("text")
        return ("run.output_text", {"text": text if isinstance(text, str) else ""})
    if kind == "usage":
        return ("run.usage", {"inputTokens": _non_negative_int(neutral_event.get("inputTokens")), "outputTokens": _non_negative_int(neutral_event.get("outputTokens"))})
    if kind == "error":
        message = neutral_event.get("message")
        return ("run.error", {"reason": "model_loop_error", "detail": message if isinstance(message, str) else ""})
    # An unrecognized framework event is dropped rather than surfaced as a candidate. Log the event
    # type only (never the payload, which may carry model content) so a silent adapter/seam drift is
    # observable without leaking anything sensitive.
    _log("framework_event_dropped", event_type=kind if isinstance(kind, str) else "")
    return None


def _absorb_steering(steering_buffer: list[str]) -> list[str]:
    """Drain and return buffered steering, applied ONLY at a pre-model-request boundary.

    Boundary invariant: this is consulted immediately before issuing a model request node and NEVER
    mid-request or mid-tool. Steering that arrives while a model request is in flight stays in the
    buffer and is absorbed at the NEXT pre-model boundary, or dropped if the attempt terminates first
    (the buffer is per-attempt and discarded with it). The drain removes exactly the entries observed
    so a concurrent enqueue between the copy and the delete is never lost. The runtime only injects
    steering text into the next model request context; it neither persists steering nor authors
    steering authority.

    Scope: this absorption boundary is built and unit-covered. The steering-INGEST HTTP surface that
    lets a user enqueue steering into an in-flight attempt is an operator/product surface delivered in
    Phase F (#224); until then the buffer has no external producer.
    """
    drained = steering_buffer[:]
    del steering_buffer[: len(drained)]
    return drained


def _non_negative_int(value: object) -> int:
    """Coerce a usage counter to a non-negative integer, defaulting unknown values to zero."""
    return value if isinstance(value, int) and value >= 0 else 0


class _ModelTurnBudget:
    """Count model requests locally so one compiled input cannot exceed its server-selected ceiling."""

    def __init__(self, maximum: int | None, used: int) -> None:
        """Create a bounded or unlimited counter from the immutable compiled budget."""
        self._maximum = maximum
        self._used = used

    @property
    def used(self) -> int:
        """Return the number of provider requests consumed across this resumable attempt."""
        return self._used

    def consume(self) -> None:
        """Reserve one model request, failing before a request could exceed the configured maximum."""
        if self._maximum is not None and self._used >= self._maximum:
            raise RuntimeError("model turn budget exhausted")
        self._used += 1


def _model_turn_budget(compiled_input: dict[str, object], used: int = 0) -> _ModelTurnBudget:
    """Read the optional positive model-turn ceiling and prior checkpoint consumption."""
    budget = compiled_input.get("budget")
    maximum = budget.get("maxModelTurns") if isinstance(budget, dict) else None
    if isinstance(used, bool) or not isinstance(used, int) or used < 0:
        raise RuntimeError("checkpoint has an invalid model turn count")
    if maximum is None:
        return _ModelTurnBudget(None, used)
    if isinstance(maximum, bool) or not isinstance(maximum, int) or maximum <= 0:
        raise RuntimeError("compiled input has an invalid model turn budget")
    return _ModelTurnBudget(maximum, used)


def _process_cipher() -> object:
    """Return the process-lifetime symmetric cipher, generating its key in memory on first use.

    ``cryptography`` is imported lazily so the outbound shell and its offline tests never require the
    package; a unit test injects a fake cipher seam instead. The key is generated once per process and
    held only in memory, matching the checkpoint's per-attempt, non-durable scope.
    """
    global _PROCESS_CIPHER
    if _PROCESS_CIPHER is None:
        from cryptography.fernet import Fernet

        _PROCESS_CIPHER = Fernet(Fernet.generate_key())
    return _PROCESS_CIPHER


def _checkpoint_path(checkpoint_dir: str | None) -> str:
    """Resolve the single fixed checkpoint path so a new write atomically replaces the prior one."""
    directory = checkpoint_dir or os.environ.get("OPENCRANE_RUNTIME_CHECKPOINT_DIR", _DEFAULT_CHECKPOINT_DIR)
    return os.path.join(directory, _CHECKPOINT_FILENAME)


def _write_checkpoint(run_id: str, attempt: int, input_generation: object, state: dict[str, object], *, cipher: object | None = None, checkpoint_dir: str | None = None) -> str:
    """Atomically write the encrypted, version-tagged local resume checkpoint, replacing any prior one.

    The checkpoint is SUBORDINATE to canonical server state: a local resume optimisation written to
    the per-attempt scratch ``emptyDir``, never a source of truth. It is encrypted with the
    process-lifetime cipher (injectable for tests), tagged with ``checkpointVersion``, and bound to
    the run, attempt, and input generation so a stale or foreign checkpoint is rejected on read. The
    write is temp-file + ``os.replace`` so a new checkpoint atomically supersedes the previous one at
    the same fixed path.
    """
    cipher = cipher or _process_cipher()
    path = _checkpoint_path(checkpoint_dir)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    document = {"checkpointVersion": _CHECKPOINT_VERSION, "runId": run_id, "attempt": attempt, "inputGeneration": input_generation, "state": state}
    plaintext = json.dumps(document, sort_keys=True, separators=(",", ":")).encode("utf-8")
    token = cipher.encrypt(plaintext)
    temporary = f"{path}.{uuid.uuid4().hex}.tmp"
    with open(temporary, "wb") as handle:
        handle.write(token)
    os.replace(temporary, path)
    return path


def _read_checkpoint(run_id: str, attempt: int, input_generation: object, *, cipher: object | None = None, checkpoint_dir: str | None = None) -> object | None:
    """Read the local checkpoint's state, but ONLY if it agrees with canonical server coordinates.

    Returns ``None`` (discard) when the checkpoint is absent, unreadable, wrong-version, or disagrees
    with the server-authoritative run, attempt, or input generation. The checkpoint is never a source
    of truth; disagreement always defers to canonical server state rather than resuming from stale
    local data.
    """
    cipher = cipher or _process_cipher()
    path = _checkpoint_path(checkpoint_dir)
    try:
        with open(path, "rb") as handle:
            token = handle.read()
    except OSError:
        return None
    try:
        document = json.loads(cipher.decrypt(token).decode("utf-8"))
    except Exception:  # noqa: BLE001 - a corrupt or foreign checkpoint is discarded, never fatal
        return None
    if not isinstance(document, dict) or document.get("checkpointVersion") != _CHECKPOINT_VERSION:
        return None
    if document.get("runId") != run_id or document.get("attempt") != attempt or document.get("inputGeneration") != input_generation:
        return None
    return document.get("state")


def _zero_retry_openai_settings() -> dict[str, int]:
    """Return the exact zero-retry model configuration proving no implicit loop retries.

    Every implicit retry path pydantic-ai 2.13.0 and its OpenAI provider expose is pinned to zero,
    and each value below is applied at a specific construction site by ``_build_zero_retry_agent``:

    - ``model_request_retries`` and ``provider_http_retries`` → the OpenAI SDK client's ``max_retries``
      (which defaults to 2). The model request is issued through the provider's ``AsyncOpenAI``
      transport, so a single ``max_retries=0`` disables both the transport-level HTTP retry and any
      model-request re-issue; both keys therefore map to that one client argument and must agree.
    - ``tool_validation_retries`` → ``Agent(retries=0)`` — pydantic-ai's default tool-argument
      validation retry count.
    - ``output_validation_retries`` → ``Agent(output_retries=0)`` — the output-validation retry count,
      set explicitly rather than inherited from ``retries`` so the proof never rests on a default.

    OpenCrane owns retry, fallback, and terminal authority, so the bounded loop must never silently
    re-issue a request, re-validate a tool call, or re-coerce output.
    """
    return {
        "model_request_retries": 0,
        "provider_http_retries": 0,
        "tool_validation_retries": 0,
        "output_validation_retries": 0,
    }


def _build_zero_retry_agent(
    model_alias: str,
    base_url: str,
    attempt_key: str,
    instructions: str,
    *,
    agent_cls: Callable[..., object] | None = None,
    model_cls: Callable[..., object] | None = None,
    provider_cls: Callable[..., object] | None = None,
    async_openai: Callable[..., object] | None = None,
) -> object:
    """Construct the bounded Pydantic AI agent with every implicit retry path pinned to zero.

    The pydantic-ai and openai symbols are imported lazily so the outbound shell and its offline tests
    never require either package. The four constructors are injectable seams: offline tests pass
    recording fakes and assert that the ``_zero_retry_openai_settings`` values actually reach the
    OpenAI client and the Agent, since pydantic-ai is not installed here to exercise a live call.
    """
    # 1. Resolve the real pydantic-ai constructors lazily, honouring any injected test seam.
    if agent_cls is None or model_cls is None or provider_cls is None:
        from pydantic_ai import Agent
        from pydantic_ai.models.openai import OpenAIModel
        from pydantic_ai.providers.openai import OpenAIProvider

        agent_cls = agent_cls or Agent
        model_cls = model_cls or OpenAIModel
        provider_cls = provider_cls or OpenAIProvider
    if async_openai is None:
        from openai import AsyncOpenAI

        async_openai = AsyncOpenAI

    settings = _zero_retry_openai_settings()
    if settings["provider_http_retries"] != settings["model_request_retries"]:
        raise RuntimeError("provider HTTP and model-request retries must agree on the transport")

    # 2. Disable OpenAI transport retries so neither the HTTP client nor the model request re-issues.
    openai_client = async_openai(base_url=base_url, api_key=attempt_key, max_retries=settings["provider_http_retries"])
    # 3. Bind the model to that zero-retry client through the provider.
    provider = provider_cls(openai_client=openai_client)
    model = model_cls(model_alias, provider=provider)
    # 4. Pin the agent's tool-argument and output validation retries to zero as well.
    return agent_cls(model, system_prompt=instructions, retries=settings["tool_validation_retries"], output_retries=settings["output_validation_retries"])


def _pydantic_ai_event_source(compiled_input: dict[str, object], cancel_event: threading.Event, steering_buffer: list[str], checkpoint_model_turns: Callable[[int], None] | None = None) -> Iterator[dict[str, object]]:
    """Drive the bounded Pydantic AI model/tool loop and yield neutral framework events.

    Pydantic AI is imported lazily so the outbound shell and its offline tests never require the
    package. The loop connects to the per-silo LiteLLM proxy over the OpenAI-compatible adapter using
    the attempt-scoped virtual key, uses ``agent.iter()`` / ``run_stream_events()`` (never the
    ``run_stream()`` final-output shortcut), and is configured with zero implicit retries. The
    excluded subsystems — Harness, sessions, UI adapters, direct MCP / hosted-tool execution,
    memory / compaction, filesystem / shell tools, and Logfire export — are disabled by omission and
    configuration, never imported and then switched off.

    ``cancel_event`` is a positive cancellation signal observed at the model-request and stream
    boundaries so a dispatched cancel kills the in-flight provider task promptly. Steering is absorbed
    from ``steering_buffer`` ONLY immediately before issuing a model request node (the sole safe
    pre-model boundary), never mid-request or mid-tool.

    The offline conformance harness drives this executor through an injected neutral-event source; the
    live-LiteLLM leg that drives real Pydantic AI over the proxy is env-guarded and gated on #337
    (ADR 0010 adoption), not run here. Offline tests inject a fake event source instead of importing
    Pydantic AI.
    """
    from pydantic_ai import Agent

    base_url = _environment("OPENCRANE_RUNTIME_LITELLM_BASE_URL")
    key_path = os.environ.get("OPENCRANE_RUNTIME_LITELLM_KEY_PATH", _DEFAULT_LITELLM_KEY_PATH)
    attempt_key = _read_attempt_litellm_key(key_path)
    model_route = compiled_input.get("model")
    model_alias = model_route.get("modelAlias") if isinstance(model_route, dict) else None
    if not isinstance(model_alias, str) or not model_alias:
        raise RuntimeError("compiled input is missing a model alias")

    instructions = compiled_input.get("instructions")
    agent = _build_zero_retry_agent(model_alias, base_url, attempt_key, instructions if isinstance(instructions, str) else "")

    # The budget is consumed immediately before each request node so a tool-driven loop cannot
    # make an additional provider call after spending the control plane's per-run turn ceiling.
    model_turn_budget = _model_turn_budget(compiled_input)

    async def _collect() -> list[dict[str, object]]:
        events: list[dict[str, object]] = []
        async with agent.iter(_prompt(compiled_input)) as run:
            async for node in run:
                if cancel_event.is_set():
                    break
                if Agent.is_model_request_node(node):
                    model_turn_budget.consume()
                    if checkpoint_model_turns is not None:
                        checkpoint_model_turns(model_turn_budget.used)
                    # Safe pre-model boundary: absorb any buffered steering into the next request
                    # context. Steering arriving after this point waits for the next boundary.
                    _apply_steering_to_request(node, _absorb_steering(steering_buffer))
                    async with node.stream(run.ctx) as request_stream:
                        async for event in request_stream:
                            if cancel_event.is_set():
                                break
                            events.append(_translate_framework_event(event))
        usage = run.usage()
        events.append({"type": "usage", "inputTokens": getattr(usage, "input_tokens", 0), "outputTokens": getattr(usage, "output_tokens", 0)})
        return events

    for event in asyncio.run(_collect()):
        if cancel_event.is_set():
            break
        yield event


def _pydantic_ai_resume_source(run_id: str, attempt: int, input_generation: object, deferred_tool_results: object, cancel_event: threading.Event, steering_buffer: list[str], *, checkpoint_cipher: object | None = None) -> Iterator[dict[str, object]]:
    """Resume the paused bounded loop by injecting control-plane-authorized deferred tool results.

    The paused loop's compiled context is recovered from the SUBORDINATE local checkpoint, which is
    discarded (raising rather than resuming from stale data) if it disagrees with the server's run,
    attempt, or input generation. The authorized deferred results are then fed back as prior tool
    results so the loop continues from the approval boundary; the runtime authors no approval and
    chooses no terminal state. Steering and cancellation are observed exactly as in the start driver.

    The offline conformance harness drives resume through an injected fake resume source; the
    live-LiteLLM resume leg is env-guarded and gated on #337 (ADR 0010 adoption), not run here.
    """
    from pydantic_ai import Agent

    state = _read_checkpoint(run_id, attempt, input_generation, cipher=checkpoint_cipher)
    compiled_input = state.get("compiledInput") if isinstance(state, dict) else None
    if not isinstance(compiled_input, dict):
        raise RuntimeError("no agreeing local checkpoint to resume from")

    base_url = _environment("OPENCRANE_RUNTIME_LITELLM_BASE_URL")
    key_path = os.environ.get("OPENCRANE_RUNTIME_LITELLM_KEY_PATH", _DEFAULT_LITELLM_KEY_PATH)
    attempt_key = _read_attempt_litellm_key(key_path)
    model_route = compiled_input.get("model")
    model_alias = model_route.get("modelAlias") if isinstance(model_route, dict) else None
    if not isinstance(model_alias, str) or not model_alias:
        raise RuntimeError("compiled input is missing a model alias")

    instructions = compiled_input.get("instructions")
    agent = _build_zero_retry_agent(model_alias, base_url, attempt_key, instructions if isinstance(instructions, str) else "")

    # Resume enters the same bounded request loop and independently rejects any malformed ceiling.
    model_turn_budget = _model_turn_budget(compiled_input, _checkpoint_model_turns_used(state))

    async def _collect() -> list[dict[str, object]]:
        events: list[dict[str, object]] = []
        # The control-plane-authorized deferred results are injected as prior tool results so the
        # bounded loop continues from the approval boundary; the runtime decides no approval.
        async with agent.iter(_prompt(compiled_input), deferred_tool_results=deferred_tool_results) as run:
            async for node in run:
                if cancel_event.is_set():
                    break
                if Agent.is_model_request_node(node):
                    model_turn_budget.consume()
                    _write_checkpoint_state(run_id, attempt, input_generation, compiled_input, checkpoint_cipher, model_turn_budget.used)
                    for steer in _absorb_steering(steering_buffer):
                        run.ctx.deps.steering.append(steer) if hasattr(getattr(run.ctx, "deps", None), "steering") else None
                    async with node.stream(run.ctx) as request_stream:
                        async for event in request_stream:
                            if cancel_event.is_set():
                                break
                            events.append(_translate_framework_event(event))
        usage = run.usage()
        events.append({"type": "usage", "inputTokens": getattr(usage, "input_tokens", 0), "outputTokens": getattr(usage, "output_tokens", 0)})
        return events

    for event in asyncio.run(_collect()):
        if cancel_event.is_set():
            break
        yield event


def _prompt(compiled_input: dict[str, object]) -> str:
    """Derive the user prompt from the compiled messages, joining their literal content in order."""
    messages = compiled_input.get("messages")
    if not isinstance(messages, list):
        return ""
    parts = [message.get("content") for message in messages if isinstance(message, dict) and isinstance(message.get("content"), str)]
    return "\n".join(part for part in parts if isinstance(part, str))


def _translate_framework_event(event: object) -> dict[str, object]:
    """Translate one Pydantic AI stream event into a neutral event dict at the adapter seam.

    Only the small, stable shape the normalizer understands crosses here; the framework object itself
    never leaves this function. Unrecognized events become a benign empty output-text event.
    """
    delta = getattr(getattr(event, "delta", None), "content_delta", None)
    if isinstance(delta, str):
        return {"type": "output_text", "text": delta}
    tool_name = getattr(getattr(event, "part", None), "tool_name", None)
    if isinstance(tool_name, str):
        part = event.part
        return {"type": "tool_call", "toolName": tool_name, "toolCallId": getattr(part, "tool_call_id", ""), "arguments": getattr(part, "args_as_json_str", lambda: "{}")()}
    return {"type": "output_text", "text": ""}


def _apply_steering_to_request(model_request_node: object, steering: list[str]) -> None:
    """Inject absorbed steering text into the pending model request context at the safe boundary.

    Called only from the pre-model-request boundary in the driver, never mid-request or mid-tool. The
    runtime merely appends steering text to the next request's user-visible context; it authors no
    steering authority and persists nothing. When no steering is buffered this is a no-op.
    """
    if not steering:
        return
    parts = getattr(getattr(model_request_node, "request", None), "parts", None)
    if isinstance(parts, list):
        parts.extend({"content": text} for text in steering)


def _dispatch_neutral_event(coordinates: dict[str, object], compiled_input: dict[str, object], neutral_event: dict[str, object], post_candidate: Callable[[dict[str, object]], None]) -> None:
    """Post the right candidate for one neutral event: external_action for tool calls, else event.

    Tool calls become bounded ``external_action`` candidates (or a hard ``run.error``) resolved
    against the compiled grant set; every other event normalizes to an ``event`` candidate. This is
    shared by the start and resume executors so both surface tool calls identically.
    """
    if neutral_event.get("type") == "tool_call":
        post_candidate(_tool_call_candidate(coordinates, compiled_input, neutral_event))
        return
    normalized = _normalize_event(neutral_event)
    if normalized is not None:
        post_candidate(_candidate(coordinates, normalized[0], normalized[1]))


def _snapshot_input_generation(payload: dict[str, object]) -> object:
    """Read the input generation carried by the accepted snapshot, defaulting to zero when absent."""
    snapshot = payload.get("snapshot") if isinstance(payload, dict) else None
    if isinstance(snapshot, dict) and isinstance(snapshot.get("inputGeneration"), int):
        return snapshot["inputGeneration"]
    return 0


def _try_write_checkpoint(coordinates: dict[str, object], payload: dict[str, object], compiled_input: dict[str, object], cipher: object | None, model_turns_used: int = 0) -> None:
    """Best-effort write of the SUBORDINATE local resume checkpoint; never blocks or fails the attempt.

    The checkpoint is a local optimisation only (never a source of truth). Any failure — including the
    absence of the crypto backend offline — is swallowed and logged so a missing checkpoint never
    turns a live attempt into an error.
    """
    _try_write_checkpoint_state(coordinates["runId"], coordinates["attempt"], _snapshot_input_generation(payload), compiled_input, cipher, model_turns_used)


def _try_write_checkpoint_state(run_id: object, attempt: object, input_generation: object, compiled_input: dict[str, object], cipher: object | None, model_turns_used: int) -> None:
    """Best-effort persist initial local resume state before any model request has been issued."""
    try:
        _write_checkpoint_state(run_id, attempt, input_generation, compiled_input, cipher, model_turns_used)
    except Exception:  # noqa: BLE001 - no model request has started, so this initial local cache remains optional
        _log("checkpoint_skipped", runId=run_id, attempt=attempt)


def _write_checkpoint_state(run_id: object, attempt: object, input_generation: object, compiled_input: dict[str, object], cipher: object | None, model_turns_used: int) -> None:
    """Persist one resume state and let a per-turn caller fail closed when the write cannot complete."""
    _write_checkpoint(run_id, attempt, input_generation, {"compiledInput": compiled_input, "modelTurnsUsed": model_turns_used}, cipher=cipher)


def _checkpoint_model_turns_used(state: object) -> int:
    """Read the non-negative cumulative turn count from a decrypted local checkpoint state."""
    if not isinstance(state, dict):
        return 0
    used = state.get("modelTurnsUsed", 0)
    if isinstance(used, bool) or not isinstance(used, int) or used < 0:
        raise RuntimeError("checkpoint has an invalid model turn count")
    return used


def _recover_compiled_input(coordinates: dict[str, object], input_generation: object, cipher: object | None) -> dict[str, object]:
    """Best-effort recovery of compiled tools from the subordinate checkpoint for resume tool calls.

    Returns an empty mapping when the checkpoint is absent, disagrees, or the crypto backend is
    unavailable offline; a resume tool call against an empty grant set then surfaces ``unknown_tool``
    rather than resuming from stale local state.
    """
    try:
        state = _read_checkpoint(coordinates["runId"], coordinates["attempt"], input_generation, cipher=cipher)
    except Exception:  # noqa: BLE001 - a subordinate checkpoint never crashes resume
        return {}
    if isinstance(state, dict) and isinstance(state.get("compiledInput"), dict):
        return state["compiledInput"]
    return {}


class _TerminalGate:
    """Guards the exactly-once terminal candidate for one attempt across the reader and worker threads.

    A run posts exactly one of ``run.completed`` / ``run.error`` / ``run.cancelled``. The completion
    path runs on the attempt worker thread while the positive-cancel path runs on the stream-reader
    thread, so the decision to post and the post itself are made atomically under one lock: a
    completion is skipped if cancellation has been signalled or a terminal already posted, and a
    cancellation is skipped if a terminal already posted. Late output can never reopen a terminal run.
    """

    def __init__(self, cancel_event: threading.Event) -> None:
        """Bind the gate to the attempt's shared cancel event."""
        self._cancel_event = cancel_event
        self._lock = threading.Lock()
        self._posted = False

    def post_completion(self, post_candidate: Callable[[dict[str, object]], None], candidate: dict[str, object]) -> bool:
        """Post a completion or error terminal only if no terminal posted and no cancel is signalled."""
        with self._lock:
            if self._posted or self._cancel_event.is_set():
                return False
            self._posted = True
        post_candidate(candidate)
        return True

    def post_cancellation(self, post_candidate: Callable[[dict[str, object]], None], candidate: dict[str, object]) -> bool:
        """Post the cancellation terminal only if no terminal has already been posted."""
        with self._lock:
            if self._posted:
                return False
            self._posted = True
        post_candidate(candidate)
        return True


def _execute_start_attempt(command: dict[str, object], runtime_instance_id: str, post_candidate: Callable[[dict[str, object]], None], event_source: Callable[..., Iterable[dict[str, object]]] = _pydantic_ai_event_source, cancel_event: threading.Event | None = None, checkpoint_cipher: object | None = None, terminal_gate: "_TerminalGate | None" = None) -> None:
    """Execute one ``start_attempt`` command as a bounded model loop, reporting candidates.

    It emits a ``run.started`` candidate, writes a subordinate local resume checkpoint, then surfaces
    every model-loop event: a tool call becomes a bounded ``external_action`` candidate resolved
    against the compiled grant set, and other events normalize to ``event`` candidates. It closes with
    ``run.completed``. Cancellation is a positive signal — once ``cancel_event`` is set no further
    candidate (not even ``run.completed`` or a late ``run.error``) is emitted, so late runtime output
    after cancel is suppressed. Because the loop performs zero implicit retries, any failure surfaces
    as a single ``run.error`` candidate, never a silent acknowledgement.
    """
    coordinates = _command_coordinates(command, runtime_instance_id)
    if coordinates is None:
        return
    if cancel_event is None:
        cancel_event = threading.Event()
    if terminal_gate is None:
        terminal_gate = _TerminalGate(cancel_event)
    payload = command.get("payload")
    compiled_input = payload.get("compiledInput") if isinstance(payload, dict) else None
    if not isinstance(compiled_input, dict):
        post_candidate(_candidate(coordinates, "run.error", {"reason": "missing_compiled_input"}))
        return
    post_candidate(_candidate(coordinates, "run.started", {"promptCompilerVersion": compiled_input.get("promptCompilerVersion")}))
    _run_evidence(coordinates, "started")
    _try_write_checkpoint(coordinates, payload if isinstance(payload, dict) else {}, compiled_input, checkpoint_cipher)
    steering_buffer: list[str] = []
    with _trace("agent_runtime.start_attempt", runId=coordinates["runId"], attempt=coordinates["attempt"]):
        try:
            if event_source is _pydantic_ai_event_source:
                def _checkpoint_model_turns(used: int) -> None:
                    """Persist consumption before the next provider request can become resumable state."""
                    _write_checkpoint_state(coordinates["runId"], coordinates["attempt"], _snapshot_input_generation(payload if isinstance(payload, dict) else {}), compiled_input, checkpoint_cipher, used)

                events = event_source(compiled_input, cancel_event, steering_buffer, _checkpoint_model_turns)
            else:
                events = event_source(compiled_input, cancel_event, steering_buffer)
            for neutral_event in events:
                if cancel_event.is_set():
                    break
                _dispatch_neutral_event(coordinates, compiled_input, neutral_event, post_candidate)
            if terminal_gate.post_completion(post_candidate, _candidate(coordinates, "run.completed", {})):
                _run_evidence(coordinates, "completed")
        except (HTTPError, URLError, OSError, RuntimeError, ValueError) as error:
            if terminal_gate.post_completion(post_candidate, _candidate(coordinates, "run.error", {"reason": "executor_failed", "errorType": type(error).__name__})):
                _run_evidence(coordinates, "error", reason="executor_failed", errorType=type(error).__name__)


def _execute_resume_attempt(command: dict[str, object], runtime_instance_id: str, post_candidate: Callable[[dict[str, object]], None], resume_event_source: Callable[..., Iterable[dict[str, object]]] = _pydantic_ai_resume_source, cancel_event: threading.Event | None = None, checkpoint_cipher: object | None = None, terminal_gate: "_TerminalGate | None" = None) -> None:
    """Resume one paused attempt by feeding control-plane-authorized deferred tool results into the loop.

    It carries the command's ``inputGeneration``, emits a ``run.resumed`` candidate, then injects the
    payload's ``deferredToolResults`` back into the model loop (via the resume driver) so the loop
    continues from where it paused for approval. Tool calls, cancellation, and errors are surfaced
    exactly as in the start executor; the runtime injects the authorized results only and decides no
    approval or terminal state.
    """
    coordinates = _command_coordinates(command, runtime_instance_id)
    if coordinates is None:
        return
    if cancel_event is None:
        cancel_event = threading.Event()
    if terminal_gate is None:
        terminal_gate = _TerminalGate(cancel_event)
    payload = command.get("payload")
    if not isinstance(payload, dict):
        post_candidate(_candidate(coordinates, "run.error", {"reason": "missing_resume_payload"}))
        return
    input_generation = payload.get("inputGeneration")
    deferred_tool_results = payload.get("deferredToolResults")
    compiled_input = _recover_compiled_input(coordinates, input_generation, checkpoint_cipher)
    post_candidate(_candidate(coordinates, "run.resumed", {"inputGeneration": input_generation}))
    _run_evidence(coordinates, "resumed", inputGeneration=input_generation)
    steering_buffer: list[str] = []
    with _trace("agent_runtime.resume_attempt", runId=coordinates["runId"], attempt=coordinates["attempt"]):
        try:
            for neutral_event in resume_event_source(coordinates["runId"], coordinates["attempt"], input_generation, deferred_tool_results, cancel_event, steering_buffer):
                if cancel_event.is_set():
                    break
                _dispatch_neutral_event(coordinates, compiled_input, neutral_event, post_candidate)
            if terminal_gate.post_completion(post_candidate, _candidate(coordinates, "run.completed", {})):
                _run_evidence(coordinates, "completed")
        except (HTTPError, URLError, OSError, RuntimeError, ValueError) as error:
            if terminal_gate.post_completion(post_candidate, _candidate(coordinates, "run.error", {"reason": "executor_failed", "errorType": type(error).__name__})):
                _run_evidence(coordinates, "error", reason="executor_failed", errorType=type(error).__name__)


def _execute_cancel_attempt(command: dict[str, object], runtime_instance_id: str, post_candidate: Callable[[dict[str, object]], None], cancel_event: threading.Event | None = None, terminal_gate: "_TerminalGate | None" = None) -> None:
    """Handle a positive-signal cancel: kill the active attempt and acknowledge the server's reason.

    Cancellation is a POSITIVE signal: on receipt the runtime sets the shared ``cancel_event`` so the
    running model/tool task stops promptly and emits no further candidate. The runtime never chooses a
    terminal state — it echoes the server-chosen reason from the ``CancelAttemptCommand`` payload as a
    bounded ``run.cancelled`` event candidate, posted through the shared terminal gate so it and the
    worker thread's completion can never both reach a terminal (exactly one terminal candidate posts).
    """
    coordinates = _command_coordinates(command, runtime_instance_id)
    if coordinates is None:
        return
    # Set the cancel event BEFORE posting so a racing completion re-checks it under the gate lock.
    if cancel_event is not None:
        cancel_event.set()
    payload = command.get("payload")
    reason = payload.get("reason") if isinstance(payload, dict) else None
    candidate = _candidate(coordinates, "run.cancelled", {"reason": reason})
    if terminal_gate is not None:
        if terminal_gate.post_cancellation(post_candidate, candidate):
            _run_evidence(coordinates, "cancelled", reason=reason)
    else:
        post_candidate(candidate)
        _run_evidence(coordinates, "cancelled", reason=reason)


def _iter_commands(response: object, cancelled: threading.Event) -> object:
    """Yield each parsed command object from a bounded server-sent-event response.

    It tracks the current SSE event name and parses the ``data`` line only for ``command`` events.
    Reading stops as soon as the connection drops so command handling is bounded to a live stream.
    """
    current_event = ""
    for raw_line in response:
        if cancelled.is_set():
            break
        if len(raw_line) > _MAX_FRAME_BYTES:
            raise RuntimeError("runtime stream frame exceeds the 64KiB boundary")
        line = raw_line.rstrip(b"\n")
        if line.startswith(b"event: "):
            current_event = line[len(b"event: "):].decode("utf-8", "replace")
        elif line.startswith(b"data: ") and current_event == "command":
            yield json.loads(line[len(b"data: "):].decode("utf-8"))
        elif line == b"":
            current_event = ""


def _open_stream(
    control_plane_url: str,
    token: str,
    runtime_instance_id: str,
    pod_uid: str,
    handle_start: Callable[..., None] = _execute_start_attempt,
    handle_resume: Callable[..., None] = _execute_resume_attempt,
    handle_cancel: Callable[..., None] = _execute_cancel_attempt,
) -> int:
    """Open one authenticated stream and dispatch each received command to its handler.

    ``start_attempt`` and ``resume_attempt`` run the active attempt on a worker thread carrying a
    fresh ``cancel_event`` so the reader keeps receiving frames; ``cancel_attempt`` is a positive
    signal that sets that event to kill the active task promptly and acknowledge the server-chosen
    reason. The three handlers are injectable seams for offline tests. When the stream drops, the
    ``finally`` block sets both the stream-loss flag and the active attempt's cancel event, so a
    missed cancel frame still holds cancellation (the fence-bump + stream-loss fallback).
    """
    body = json.dumps({"protocolVersion": _PROTOCOL_VERSION, "runtimeInstanceId": runtime_instance_id, "podUid": pod_uid}).encode("utf-8")
    request = Request(f"{control_plane_url.rstrip('/')}/stream", data=body, headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json", "Accept": "text/event-stream"}, method="POST")
    stream_lost = threading.Event()
    active_cancel: threading.Event | None = None
    active_gate: _TerminalGate | None = None

    def _post_stream_candidate(candidate: dict[str, object]) -> None:
        _post_candidate_with_retry(control_plane_url, token, candidate, stream_lost)

    try:
        with urlopen(request, timeout=45) as response:
            if response.status != 200:
                raise RuntimeError(f"runtime stream returned unexpected status {response.status}")
            _log("stream_connected", runtime_instance_id=runtime_instance_id)
            for command in _iter_commands(response, stream_lost):
                if stream_lost.is_set():
                    break
                kind = command.get("kind")
                if kind == "start_attempt":
                    active_cancel = threading.Event()
                    active_gate = _TerminalGate(active_cancel)
                    def _post_start_candidate(candidate: dict[str, object], cancelled: threading.Event = active_cancel) -> None:
                        _post_candidate_with_retry(control_plane_url, token, candidate, cancelled)
                    threading.Thread(target=handle_start, args=(command, runtime_instance_id, _post_start_candidate), kwargs={"cancel_event": active_cancel, "terminal_gate": active_gate}, daemon=True).start()
                elif kind == "resume_attempt":
                    active_cancel = threading.Event()
                    active_gate = _TerminalGate(active_cancel)
                    def _post_resume_candidate(candidate: dict[str, object], cancelled: threading.Event = active_cancel) -> None:
                        _post_candidate_with_retry(control_plane_url, token, candidate, cancelled)
                    threading.Thread(target=handle_resume, args=(command, runtime_instance_id, _post_resume_candidate), kwargs={"cancel_event": active_cancel, "terminal_gate": active_gate}, daemon=True).start()
                elif kind == "cancel_attempt":
                    handle_cancel(command, runtime_instance_id, _post_stream_candidate, cancel_event=active_cancel, terminal_gate=active_gate)
                else:
                    continue
                _log("command_dispatched", runtime_instance_id=runtime_instance_id, command_kind=kind)
    finally:
        # Bounded local cancellation: once the stream context exits, stop reading and signal the
        # active attempt so a lost connection cannot keep working against a dead attempt.
        stream_lost.set()
        if active_cancel is not None:
            active_cancel.set()
    return 0


def _retry_delay(attempt: int) -> float:
    """Use bounded jittered reconnects so a missing authority cannot create a retry storm."""
    return min(30.0, (2 ** min(attempt, 5)) + random.uniform(0.0, 1.0))


def run_forever(open_stream: Callable[[str, str, str, str], int] = _open_stream, perform_bootstrap: Callable[[str, str, str, dict[str, object]], None] = _perform_bootstrap) -> None:
    """Perform the one-use bootstrap, then maintain the sole outbound command stream for this Pod.

    The bootstrap runs exactly once: a permanent refusal ends the process fail-closed, while a
    transient error retries with bounded jitter. The projected token is reread for each connection so
    kubelet rotation takes effect without a process restart; failures are logged without credential
    contents and retried with bounded jitter. This function never falls back to a static token,
    a second bootstrap, or a local durable queue.
    """
    control_plane_url = _environment("OPENCRANE_RUNTIME_STREAM_URL")
    token_path = _environment("OPENCRANE_RUNTIME_TOKEN_PATH", _DEFAULT_TOKEN_PATH)
    bootstrap_path = _environment("OPENCRANE_RUNTIME_BOOTSTRAP_PATH", _DEFAULT_BOOTSTRAP_PATH)
    pod_uid = _environment("POD_UID")
    runtime_instance_id = str(uuid.uuid4())
    proof_key = _generate_proof_key()
    bootstrap_reference = _read_bootstrap_reference(bootstrap_path)
    _log("runtime_started", runtime_instance_id=runtime_instance_id)

    # 1. Bind the public proof key exactly once before any command stream is opened.
    attempts = 0
    while True:
        try:
            perform_bootstrap(control_plane_url, _read_projected_token(token_path), bootstrap_reference, proof_key)
            break
        except BootstrapDeniedError as error:
            _log("bootstrap_denied", runtime_instance_id=runtime_instance_id, error_type=type(error).__name__)
            return
        except (HTTPError, URLError, OSError, RuntimeError) as error:
            attempts += 1
            delay_seconds = _retry_delay(attempts)
            _log("bootstrap_retry", runtime_instance_id=runtime_instance_id, error_type=type(error).__name__, retry_in_seconds=round(delay_seconds, 2))
            time.sleep(delay_seconds)

    # 2. Maintain the single command stream, reconnecting with bounded jitter on any loss.
    attempts = 0
    while True:
        try:
            open_stream(control_plane_url, _read_projected_token(token_path), runtime_instance_id, pod_uid)
            attempts = 0
        except (HTTPError, URLError, OSError, RuntimeError) as error:
            attempts += 1
            delay_seconds = _retry_delay(attempts)
            _log("stream_disconnected", runtime_instance_id=runtime_instance_id, error_type=type(error).__name__, retry_in_seconds=round(delay_seconds, 2))
            time.sleep(delay_seconds)


if __name__ == "__main__":
    try:
        run_forever()
    except KeyboardInterrupt:
        _log("runtime_stopped")
        sys.exit(0)
