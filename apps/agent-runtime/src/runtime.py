"""Compose and supervise the outbound-only OpenCrane agent-runtime process.

Collaborating functional components live in focused packages: ``bootstrap`` binds public proof-key
evidence, ``transport`` owns outbound control-plane I/O, ``attempts`` executes received commands,
``model_loop`` adapts Pydantic AI, and ``protocol`` projects stable candidates.

This module owns only process configuration, bootstrap-before-stream ordering, bounded reconnect
policy, and the executable entrypoint. It owns no command handling, model behaviour, protocol
projection, or durable run state; see ``src/README.md`` for the complete component graph.
"""

import random
import sys
import time
import uuid
from collections.abc import Callable
from urllib.error import HTTPError, URLError

# These aliases mark where the process is composed: the entrypoint chooses concrete implementations,
# while ``run_forever`` receives callables so lifecycle policy can be tested without real identity,
# network, or model infrastructure. Lower-level packages must not import this composition root.
from .bootstrap.exchange import BootstrapDeniedError, perform_bootstrap as _perform_bootstrap, perform_warm_binding as _perform_warm_binding
from .bootstrap.proof import generate_proof_key
from .config import (
    environment,
    read_bootstrap_reference,
    read_projected_token,
)
from .constants import DEFAULT_BOOTSTRAP_PATH, DEFAULT_TOKEN_PATH
from .observability import log
from .transport.stream import open_stream as _open_stream
from .warm_runtime import start_warm_readiness_server as _start_warm_readiness_server


def retry_delay(attempt: int) -> float:
    """Return exponential reconnect delay with jitter and a hard thirty-second ceiling.

    Jitter prevents many runtime Pods from reconnecting in lockstep after a control-plane outage.
    Capping the exponent and final delay keeps recovery responsive and prevents unbounded sleeps.
    """
    return min(30.0, (2 ** min(attempt, 5)) + random.uniform(0.0, 1.0))


def run_forever(
    open_stream: Callable[[str, str, str, str], int] = _open_stream,
    perform_bootstrap: Callable[[str, str, str, dict[str, object]], None] = _perform_bootstrap,
    perform_warm_binding: Callable[[str, str, dict[str, object]], str] = _perform_warm_binding,
    generate_key: Callable[[], dict[str, object]] = generate_proof_key,
    start_warm_readiness_server: Callable[[int, str, str], object] = _start_warm_readiness_server,
) -> None:
    """Perform one-use bootstrap, then supervise the Pod's outbound stream forever.

    Bootstrap has its own loop because a permanent refusal must terminate the process, while an
    unavailable control plane may be retried without opening a stream. After binding succeeds, each
    new stream connection rereads the projected token so kubelet rotation takes effect.

    The callable parameters are offline-test seams. Production uses the concrete bootstrap, key
    generation, and stream implementations imported above.
    """
    # Configuration is resolved before generating proof evidence. A missing mount or setting prevents
    # any identity claim or network work from starting.
    #
    # Keep this order deliberate. Resolve the endpoint, projected-file paths, and Pod coordinate
    # before constructing process identity; actual mounted-file reads remain at their point of use.
    runtime_mode = environment("OPENCRANE_RUNTIME_MODE", "job")
    control_plane_url = environment("OPENCRANE_RUNTIME_STREAM_URL")
    token_path = environment("OPENCRANE_RUNTIME_TOKEN_PATH", DEFAULT_TOKEN_PATH)
    pod_uid = environment("POD_UID")

    # The instance id distinguishes this process lifetime from a replacement Pod or restarted
    # process. It remains stable across transport reconnects, whereas the projected token below is
    # intentionally reread because its credential lifetime is shorter than the process lifetime.
    runtime_instance_id = str(uuid.uuid4())

    # Generate one proof key for the one-use binding attempt and retain the same public evidence
    # across transient bootstrap failures. Regeneration during retries would make an ambiguous
    # accepted response impossible to reconcile with the evidence held by this process.
    proof_key = generate_key()

    bootstrap_reference = None
    if runtime_mode == "job":
        bootstrap_reference_path = environment(
            "OPENCRANE_RUNTIME_BOOTSTRAP_PATH",
            DEFAULT_BOOTSTRAP_PATH,
        )
        # The bootstrap reference is workload-selection evidence, not a general credential. Reading
        # it once preserves the identity being bound; only the rotating workload token is refreshed.
        bootstrap_reference = read_bootstrap_reference(bootstrap_reference_path)
    elif runtime_mode == "warm":
        readiness_port = int(environment("OPENCRANE_WARM_BINDING_PORT"))
        claimed_profile = environment("OPENCRANE_WARM_PROFILE")
        start_warm_readiness_server(readiness_port, pod_uid, claimed_profile)
    else:
        raise RuntimeError("OPENCRANE_RUNTIME_MODE must be job or warm")
    log("runtime_started", runtime_instance_id=runtime_instance_id)

    # Phase 1: bind public proof evidence exactly once. Transient failures retry the same reference
    # and evidence; a control-plane refusal is final and no command stream is opened.
    attempts = 0
    attempt_model_key = None
    while True:
        try:
            # Token access stays inside the retry attempt so a kubelet rotation between attempts is
            # observed without persisting credential material in process configuration or logs.
            if runtime_mode == "warm":
                attempt_model_key = perform_warm_binding(
                    control_plane_url,
                    read_projected_token(token_path),
                    proof_key,
                )
            else:
                perform_bootstrap(
                    control_plane_url,
                    read_projected_token(token_path),
                    bootstrap_reference,
                    proof_key,
                )
            break
        except BootstrapDeniedError as error:
            # A denial is an authority decision, not a connectivity condition. Retrying it would
            # turn a one-use admission fence into an availability policy owned by this Pod.
            log(
                "bootstrap_denied",
                runtime_instance_id=runtime_instance_id,
                error_type=type(error).__name__,
            )
            return
        except (HTTPError, URLError, OSError, RuntimeError) as error:
            # Log the exception type only. URLs, headers, or mounted-file details may contain
            # sensitive deployment information.
            #
            # These exception families include projected-file races as well as transient transport
            # failures. Both are safe to retry because no command stream has been admitted yet.
            attempts += 1
            delay_seconds = retry_delay(attempts)
            log(
                "bootstrap_retry",
                runtime_instance_id=runtime_instance_id,
                error_type=type(error).__name__,
                retry_in_seconds=round(delay_seconds, 2),
            )
            time.sleep(delay_seconds)

    # Phase 2: maintain the sole authority channel. Every reconnect rereads the rotating token while
    # retaining this process instance id and Pod identity.
    attempts = 0
    while True:
        try:
            # ``open_stream`` owns command dispatch and active-attempt cancellation for the lifetime
            # of this connection. It returns only after that connection's workers have been fenced,
            # so reconnecting here cannot intentionally keep an old stream's executor alive.
            if runtime_mode == "warm":
                open_stream(
                    control_plane_url,
                    read_projected_token(token_path),
                    runtime_instance_id,
                    pod_uid,
                    attempt_model_key=attempt_model_key,
                )
            else:
                open_stream(
                    control_plane_url,
                    read_projected_token(token_path),
                    runtime_instance_id,
                    pod_uid,
                )
            # EOF is not a successful terminal state: the Pod must keep its sole authority channel.
            # Back it off exactly like a transport exception so a peer returning immediate 200/EOF
            # cannot drive a hot reconnect loop.
            #
            # Do not reset ``attempts`` after a connection opens: repeated short-lived clean closes
            # are still an outage pattern. A healthy stream normally remains inside ``open_stream``.
            attempts += 1
            delay_seconds = retry_delay(attempts)
            log(
                "stream_disconnected",
                runtime_instance_id=runtime_instance_id,
                error_type="StreamClosed",
                retry_in_seconds=round(delay_seconds, 2),
            )
            time.sleep(delay_seconds)
        except (HTTPError, URLError, OSError, RuntimeError) as error:
            # Cancellation caused by Pod termination is intentionally outside this retry policy;
            # SIGTERM ends the process. These recoverable failures describe only loss of the
            # outbound authority channel, after which dispatch must stop until reconnection.
            attempts += 1
            delay_seconds = retry_delay(attempts)
            log(
                "stream_disconnected",
                runtime_instance_id=runtime_instance_id,
                error_type=type(error).__name__,
                retry_in_seconds=round(delay_seconds, 2),
            )
            time.sleep(delay_seconds)


if __name__ == "__main__":
    # SIGTERM remains the container orchestrator's termination path. KeyboardInterrupt is handled
    # only for an operator running the module interactively.
    # Keep signal ownership out of ``run_forever`` so tests can exercise lifecycle policy without
    # installing process-global handlers, and so Kubernetes receives normal termination semantics.
    try:
        run_forever()
    except KeyboardInterrupt:
        log("runtime_stopped")
        sys.exit(0)
