"""Read process configuration and mounted identity material without widening secret scope.

This module is the only place that turns environment-variable names or projected file paths into
runtime values. Callers receive only the value they need, while this module never logs file contents
or includes them in error messages. Empty values fail closed because falling back to another
identity, credential, or endpoint would cross the admitted workload boundary.
"""

import os


def environment(name: str, default: str | None = None) -> str:
    """Return a required setting or its explicit default.

    The exception names the missing setting, not its value. Treat whitespace-only values as present:
    environment syntax is outside this module's authority, while each consumer validates the value's
    domain shape where necessary.

    Raises:
        RuntimeError: When neither a non-empty environment value nor a non-empty default exists.
    """
    value = os.environ.get(name, default)
    if not value:
        raise RuntimeError(f"{name} must be configured")
    return value


def read_projected_token(token_path: str) -> str:
    """Read the rotating workload token at the moment a connection is opened.

    Kubelet may replace the projected file while the process is alive. Reading on demand, rather than
    caching at startup, lets the next bootstrap or stream connection use the rotated token.

    Raises:
        OSError: When the projected file cannot be read.
        RuntimeError: When the file contains no token after its projected newline is stripped.
    """
    with open(token_path, "r", encoding="utf-8") as token_file:
        token = token_file.read().strip()
    if not token:
        raise RuntimeError("projected runtime token is empty")
    return token


def read_bootstrap_reference(bootstrap_path: str) -> str:
    """Read the opaque one-use bootstrap lookup reference projected into the Pod.

    The reference is not a bearer credential, but it still identifies an admitted workload. Keeping
    it in a mounted file avoids exposing it in process arguments or ordinary environment inspection.

    Raises:
        OSError: When the projected file cannot be read.
        RuntimeError: When the file contains no reference.
    """
    with open(bootstrap_path, "r", encoding="utf-8") as reference_file:
        reference = reference_file.read().strip()
    if not reference:
        raise RuntimeError("projected bootstrap reference is empty")
    return reference


def read_attempt_litellm_key(key_path: str) -> str:
    """Read the attempt-scoped LiteLLM key immediately before model construction.

    This is the runtime's only model credential. It is deliberately returned only to the model
    adapter and must never be logged, checkpointed, added to a candidate, or retained in global
    process state.

    Raises:
        OSError: When the mounted Secret cannot be read.
        RuntimeError: When the mounted Secret is empty.
    """
    with open(key_path, "r", encoding="utf-8") as key_file:
        key = key_file.read().strip()
    if not key:
        raise RuntimeError("attempt-scoped LiteLLM key is empty")
    return key
