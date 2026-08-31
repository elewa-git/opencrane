"""Create and reload the public cryptographic evidence used by one warm Pod.

The control plane binds a fresh P-256 public key and its RFC 7638 thumbprint to the admitted runtime.
Only public evidence leaves this module. The private key object is never serialised, logged, written,
or returned. Public evidence survives a container restart in the same Pod's temporary scratch.
"""

import base64
import hashlib
import json
import os
import tempfile
from pathlib import Path

from ..constants import DEFAULT_PROOF_EVIDENCE_PATH


def base64url(raw: bytes) -> str:
    """Encode bytes as unpadded base64url, as required by JSON Web Key coordinates."""
    # JWK thumbprints operate on the unpadded URL-safe representation. Retaining ``=`` padding would
    # make the public document look equivalent to a reader but produce a different identity digest.
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def rfc7638_thumbprint(x_coordinate: str, y_coordinate: str) -> str:
    """Return the deterministic RFC 7638 thumbprint for a P-256 public key.

    RFC 7638 hashes a canonical JSON object. Explicit member order and compact separators prevent
    equivalent keys from acquiring different thumbprints because of serializer formatting.
    """
    # The required member order is crv, kty, x, y. Do not replace this with a general-purpose dump
    # whose ordering policy could change the bootstrap identity.
    canonical = json.dumps(
        {"crv": "P-256", "kty": "EC", "x": x_coordinate, "y": y_coordinate},
        separators=(",", ":"),
        sort_keys=False,
    )
    return base64url(hashlib.sha256(canonical.encode("utf-8")).digest())


def generate_proof_key() -> dict[str, object]:
    """Generate one keypair and return only its public binding evidence.

    The private object remains local to this function and becomes unreachable after the public
    coordinates are derived. The returned dictionary is intentionally shaped for
    ``bootstrap/exchange.py`` and contains no serialisable secret material.
    """
    # Load the optional cryptographic dependency only at the identity boundary. Configuration and
    # import-only tooling can inspect the runtime without generating or retaining key material.
    from cryptography.hazmat.primitives.asymmetric import ec

    # Freshness matters here: this private key object names one Pod binding and never leaves this
    # function. Only its public coordinates and thumbprint survive for restart replay; no private
    # key material reaches the scratch file, checkpoint, or server store.
    private_key = ec.generate_private_key(ec.SECP256R1())
    numbers = private_key.public_key().public_numbers()
    # P-256 coordinates are fixed-width 32-byte unsigned integers before base64url encoding.
    x_coordinate = base64url(numbers.x.to_bytes(32, "big"))
    y_coordinate = base64url(numbers.y.to_bytes(32, "big"))
    # The exchange receives only the public half. Returning the private object would invite callers
    # to serialize it or broaden proof-key custody beyond this deliberately narrow bootstrap path.
    public_jwk = {"kty": "EC", "crv": "P-256", "x": x_coordinate, "y": y_coordinate}
    return {
        "publicJwk": public_jwk,
        "thumbprint": rfc7638_thumbprint(x_coordinate, y_coordinate),
    }


def load_or_create_proof_key(path: str = DEFAULT_PROOF_EVIDENCE_PATH) -> dict[str, object]:
    """Load stable public proof evidence for this Pod, or create it before the first bind.

    A Deployment may restart the container while keeping the same Pod and ``emptyDir``. The server
    accepts a claimed reservation replay only with the first public thumbprint, so the public JWK is
    saved before binding. The file contains no private key or model key.

    Raises:
        OSError: When the evidence file cannot be read or written safely.
        RuntimeError: When saved evidence is malformed or does not match its thumbprint.
    """
    evidence_path = Path(path)
    if evidence_path.exists():
        return _read_proof_evidence(evidence_path)
    evidence = generate_proof_key()
    evidence_path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    temporary_path: str | None = None
    try:
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=evidence_path.parent, prefix=".proof-evidence-", delete=False) as temporary:
            temporary_path = temporary.name
            json.dump(evidence, temporary, separators=(",", ":"), sort_keys=True)
            temporary.flush()
            os.fsync(temporary.fileno())
        os.chmod(temporary_path, 0o600)
        os.replace(temporary_path, evidence_path)
        temporary_path = None
    finally:
        if temporary_path is not None:
            try:
                os.unlink(temporary_path)
            except FileNotFoundError:
                pass
    return evidence


def _read_proof_evidence(path: Path) -> dict[str, object]:
    """Read and verify one bounded public proof-evidence document."""
    with path.open("r", encoding="utf-8") as evidence_file:
        raw = evidence_file.read(16 * 1024 + 1)
    if len(raw) > 16 * 1024:
        raise RuntimeError("saved proof evidence is too large")
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as error:
        raise RuntimeError("saved proof evidence is invalid JSON") from error
    public_jwk = parsed.get("publicJwk") if isinstance(parsed, dict) else None
    thumbprint = parsed.get("thumbprint") if isinstance(parsed, dict) else None
    if not isinstance(public_jwk, dict) or public_jwk.get("kty") != "EC" or public_jwk.get("crv") != "P-256" or not isinstance(public_jwk.get("x"), str) or not isinstance(public_jwk.get("y"), str) or not isinstance(thumbprint, str):
        raise RuntimeError("saved proof evidence has an invalid shape")
    expected = rfc7638_thumbprint(public_jwk["x"], public_jwk["y"])
    if thumbprint != expected:
        raise RuntimeError("saved proof evidence thumbprint does not match")
    return {"publicJwk": {"kty": "EC", "crv": "P-256", "x": public_jwk["x"], "y": public_jwk["y"]}, "thumbprint": thumbprint}
