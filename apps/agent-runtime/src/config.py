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
    # This accessor deliberately distinguishes absence/empty from malformed-but-present values.
    # Path, URL, and identifier shape validation stays with the component that owns that domain;
    # converting it centrally here could make two security boundaries read one setting differently.
    value = os.environ.get(name, default)
    if not value:
        # Mention only the public configuration key. Echoing the supplied value in an exception can
        # leak secrets later when startup failures are collected by platform logging.
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
    # Open the projected path for each use instead of holding a file descriptor: Kubernetes may
    # rotate a projected token by replacing the backing file rather than mutating the open inode.
    with open(token_path, "r", encoding="utf-8") as token_file:
        token = token_file.read().strip()
    if not token:
        # Fail closed during an empty projection window. No fallback token source is permitted,
        # because it could silently exchange one workload identity for another.
        raise RuntimeError("projected runtime token is empty")
    return token
