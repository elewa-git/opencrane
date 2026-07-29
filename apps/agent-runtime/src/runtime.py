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

from .bootstrap.exchange import BootstrapDeniedError, perform_bootstrap as _perform_bootstrap
from .bootstrap.proof import generate_proof_key
from .config import (
    environment,
    read_bootstrap_reference,
    read_projected_token,
)
from .constants import DEFAULT_BOOTSTRAP_PATH, DEFAULT_TOKEN_PATH
from .observability import log
from .transport.stream import open_stream as _open_stream


def retry_delay(attempt: int) -> float:
    """Return exponential reconnect delay with jitter and a hard thirty-second ceiling.

    Jitter prevents many runtime Pods from reconnecting in lockstep after a control-plane outage.
    Capping the exponent and final delay keeps recovery responsive and prevents unbounded sleeps.
    """
    return min(30.0, (2 ** min(attempt, 5)) + random.uniform(0.0, 1.0))


def run_forever(
    open_stream: Callable[[str, str, str, str], int] = _open_stream,
    perform_bootstrap: Callable[[str, str, str, dict[str, object]], None] = _perform_bootstrap,
    generate_key: Callable[[], dict[str, object]] = generate_proof_key,
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
    control_plane_url = environment("OPENCRANE_RUNTIME_STREAM_URL")
    token_path = environment("OPENCRANE_RUNTIME_TOKEN_PATH", DEFAULT_TOKEN_PATH)
    bootstrap_reference_path = environment(
        "OPENCRANE_RUNTIME_BOOTSTRAP_PATH",
        DEFAULT_BOOTSTRAP_PATH,
    )
    pod_uid = environment("POD_UID")
    runtime_instance_id = str(uuid.uuid4())
    proof_key = generate_key()
    bootstrap_reference = read_bootstrap_reference(bootstrap_reference_path)
    log("runtime_started", runtime_instance_id=runtime_instance_id)

    # Phase 1: bind public proof evidence exactly once. Transient failures retry the same reference
    # and evidence; a control-plane refusal is final and no command stream is opened.
    attempts = 0
    while True:
        try:
            perform_bootstrap(
                control_plane_url,
                read_projected_token(token_path),
                bootstrap_reference,
                proof_key,
            )
            break
        except BootstrapDeniedError as error:
            log(
                "bootstrap_denied",
                runtime_instance_id=runtime_instance_id,
                error_type=type(error).__name__,
            )
            return
        except (HTTPError, URLError, OSError, RuntimeError) as error:
            # Log the exception type only. URLs, headers, or mounted-file details may contain
            # sensitive deployment information.
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
            open_stream(
                control_plane_url,
                read_projected_token(token_path),
                runtime_instance_id,
                pod_uid,
            )
            # EOF is not a successful terminal state: the Pod must keep its sole authority channel.
            # Back it off exactly like a transport exception so a peer returning immediate 200/EOF
            # cannot drive a hot reconnect loop.
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
    try:
        run_forever()
    except KeyboardInterrupt:
        log("runtime_stopped")
        sys.exit(0)
