"""Run the existing agent-runtime flow with an explicit development model strategy.

Alternatives A and B select ``litellm`` and therefore use the unchanged production handlers against
their configured local or remote proxy. Alternative C selects ``simulated`` and injects only the
neutral event source; bootstrap, stream admission, start/resume execution, event projection, and
candidate delivery remain unchanged. The production ``runtime.py`` entrypoint never imports this
module or its development adapters.
"""

import sys

from .attempts.execution import execute_resume_attempt, execute_start_attempt
from .config import environment
from .development.deterministic_model import (
    deterministic_event_source,
    deterministic_resume_event_source,
)
from .observability import log
from .runtime import run_forever
from .transport.stream import open_stream

_LITELLM_STRATEGY = "litellm"
_SIMULATED_STRATEGY = "simulated"


def _simulated_start(*args: object, **kwargs: object) -> None:
    """Run an admitted start command through deterministic events and the existing executor."""
    execute_start_attempt(*args, **kwargs, event_source=deterministic_event_source)


def _simulated_resume(*args: object, **kwargs: object) -> None:
    """Run an admitted resume command through deterministic events and the existing executor."""
    execute_resume_attempt(*args, **kwargs, resume_event_source=deterministic_resume_event_source)


def development_open_stream(
    control_plane_url: str,
    token: str,
    runtime_instance_id: str,
    pod_uid: str,
) -> int:
    """Open the normal authority stream with handlers selected before command dispatch."""
    strategy = environment("OPENCRANE_RUNTIME_MODEL_STRATEGY")
    if strategy == _LITELLM_STRATEGY:
        return open_stream(control_plane_url, token, runtime_instance_id, pod_uid)
    if strategy == _SIMULATED_STRATEGY:
        return open_stream(
            control_plane_url,
            token,
            runtime_instance_id,
            pod_uid,
            handle_start=_simulated_start,
            handle_resume=_simulated_resume,
        )
    raise RuntimeError("OPENCRANE_RUNTIME_MODEL_STRATEGY is not supported")


if __name__ == "__main__":
    try:
        run_forever(open_stream=development_open_stream)
    except KeyboardInterrupt:
        log("runtime_stopped")
        sys.exit(0)
