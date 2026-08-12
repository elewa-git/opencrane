"""Maintain the runtime's encrypted, replaceable, subordinate checkpoint.

The checkpoint exists only to help this process continue an authorised resume. It is not durable
agent memory and never proves that a run may continue. Every read is checked against the
server-supplied run id, attempt, and input generation; disagreement is treated exactly like a missing
file. The control plane remains the source of truth.
"""

import json
import os
import uuid

from ..config import environment
from ..constants import (
    CHECKPOINT_FILENAME,
    CHECKPOINT_VERSION,
    DEFAULT_CHECKPOINT_DIR,
)

# One in-memory key is shared by checkpoints written during this process lifetime. A restarted
# process intentionally cannot decrypt an older scratch checkpoint; it must recover from server
# authority instead of treating local bytes as durable state.
_PROCESS_CIPHER: object | None = None


def process_cipher() -> object:
    """Return the lazily-created process-lifetime Fernet cipher.

    The key is generated in memory and never exported. Tests may inject a cipher into the public
    read/write seams, which keeps offline tests independent of the cryptography package.
    """
    global _PROCESS_CIPHER
    if _PROCESS_CIPHER is None:
        from cryptography.fernet import Fernet

        _PROCESS_CIPHER = Fernet(Fernet.generate_key())
    return _PROCESS_CIPHER


def checkpoint_path(checkpoint_dir: str | None) -> str:
    """Return the one checkpoint path, which each write replaces in place.

    An explicit directory is a test seam. Production otherwise honours the documented environment
    setting and finally the bounded scratch default. The fixed filename prevents accumulation of an
    unbounded local checkpoint history.
    """
    directory = checkpoint_dir or environment(
        "OPENCRANE_RUNTIME_CHECKPOINT_DIR",
        DEFAULT_CHECKPOINT_DIR,
    )
    return os.path.join(directory, CHECKPOINT_FILENAME)


def write_checkpoint(
    run_id: str,
    attempt: int,
    input_generation: object,
    state: dict[str, object],
    *,
    cipher: object | None = None,
    checkpoint_dir: str | None = None,
) -> str:
    """Encrypt and atomically replace the checkpoint for one accepted input generation.

    The plaintext envelope carries the coordinates needed to reject a stale or foreign file on read.
    A uniquely named temporary file is written in the same directory and then replaced atomically, so
    a crash leaves either the previous complete checkpoint or the new complete checkpoint.

    Returns:
        The fixed checkpoint path that now contains the encrypted document.

    Raises:
        OSError: When the scratch directory cannot be created, written, or replaced.
        Exception: When the injected or process cipher cannot encrypt the document.
    """
    cipher = cipher or process_cipher()
    path = checkpoint_path(checkpoint_dir)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    document = {
        "checkpointVersion": CHECKPOINT_VERSION,
        "runId": run_id,
        "attempt": attempt,
        "inputGeneration": input_generation,
        "state": state,
    }
    plaintext = json.dumps(document, sort_keys=True, separators=(",", ":")).encode("utf-8")
    token = cipher.encrypt(plaintext)
    # os.replace is atomic when source and destination share a filesystem; the temporary file is
    # deliberately created beside the destination to retain that guarantee.
    temporary = f"{path}.{uuid.uuid4().hex}.tmp"
    with open(temporary, "wb") as handle:
        handle.write(token)
    os.replace(temporary, path)
    return path


def read_checkpoint(
    run_id: str,
    attempt: int,
    input_generation: object,
    *,
    cipher: object | None = None,
    checkpoint_dir: str | None = None,
) -> object | None:
    """Return checkpoint state only when format and all server coordinates agree.

    Absence, unreadable bytes, decryption failure, invalid JSON, an unknown version, or mismatched
    coordinates all return ``None``. Those cases are ordinary loss of a local optimisation, not a run
    failure and never a reason to weaken validation.
    """
    cipher = cipher or process_cipher()
    path = checkpoint_path(checkpoint_dir)
    try:
        with open(path, "rb") as handle:
            token = handle.read()
    except OSError:
        return None
    try:
        document = json.loads(cipher.decrypt(token).decode("utf-8"))
    except Exception:  # noqa: BLE001 - a corrupt or foreign checkpoint is discarded
        # Cipher and parser errors intentionally collapse to "no usable local state"; exposing their
        # details could leak file contents and would make the optimisation load-bearing.
        return None
    if not isinstance(document, dict) or document.get("checkpointVersion") != CHECKPOINT_VERSION:
        return None
    if (
        document.get("runId") != run_id
        or document.get("attempt") != attempt
        or document.get("inputGeneration") != input_generation
    ):
        # Server-supplied coordinates always win over local scratch, including after a retry or new
        # input generation for the same run.
        return None
    return document.get("state")
