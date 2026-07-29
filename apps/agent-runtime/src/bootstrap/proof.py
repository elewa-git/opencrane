"""Create the public cryptographic evidence used by the one-use bootstrap.

The control plane binds a fresh P-256 public key and its RFC 7638 thumbprint to the admitted runtime.
Only public evidence leaves this module. The private key object is never serialised, logged, written,
or returned by the current bootstrap-only flow.
"""

import base64
import hashlib
import json


def base64url(raw: bytes) -> str:
    """Encode bytes as unpadded base64url, as required by JSON Web Key coordinates."""
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
    """Generate one keypair and return only its public bootstrap evidence.

    The private object remains local to this function and becomes unreachable after the public
    coordinates are derived. The returned dictionary is intentionally shaped for
    ``bootstrap/exchange.py`` and contains no serialisable secret material.
    """
    from cryptography.hazmat.primitives.asymmetric import ec

    private_key = ec.generate_private_key(ec.SECP256R1())
    numbers = private_key.public_key().public_numbers()
    # P-256 coordinates are fixed-width 32-byte unsigned integers before base64url encoding.
    x_coordinate = base64url(numbers.x.to_bytes(32, "big"))
    y_coordinate = base64url(numbers.y.to_bytes(32, "big"))
    public_jwk = {"kty": "EC", "crv": "P-256", "x": x_coordinate, "y": y_coordinate}
    return {
        "publicJwk": public_jwk,
        "thumbprint": rfc7638_thumbprint(x_coordinate, y_coordinate),
    }
