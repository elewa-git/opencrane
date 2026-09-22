"""Bind one local rejection to the physical request admitted by OpenCrane.

The response authenticator reuses the incoming attempt key under separate HMAC
domains. It protects against provider-supplied errors under the existing private
bearer transport boundary; it does not protect a bearer key intercepted in transit.
The caller must also require its qualified managed endpoint and exact saved request.
"""

from contextvars import ContextVar
from dataclasses import dataclass, field
import hashlib
import hmac
import json
import re


CONTRACT_VERSION = "opencrane.preforward-rate-limit.v1"
CONTRACT_HEADER = "x-opencrane-preforward-contract"
NONCE_HEADER = "x-opencrane-request-nonce"
FENCE_HEADER = "x-opencrane-logical-fence"
DEADLINE_HEADER = "x-opencrane-request-deadline"
RECEIPT_HEADER = "x-opencrane-preforward-receipt"
MAX_REQUEST_BYTES = 1024 * 1024
MAX_RECEIPT_BYTES = 2048
MAX_REQUEST_LIFETIME_MS = 25_000
MAX_SAFE_INTEGER = 9_007_199_254_740_991
KEY_DOMAIN = b"opencrane:preforward-receipt:key:v1"
MESSAGE_DOMAIN = b"opencrane:preforward-receipt:message:v1\x00"
HEX_64 = re.compile(r"[0-9a-f]{64}\Z")


@dataclass(frozen=True)
class RequestCoordinates:
    """Retain the exact nonsecret request coordinates covered by the response MAC."""

    physical_nonce: str
    logical_fence: str
    request_body_sha256: str
    deadline_epoch_ms: int


@dataclass
class RequestProof:
    """Track the one permitted limiter evaluation before this request can route.

    This object exists only for one processor call. Re-entering the limiter or
    completing pre-call processing permanently closes its permission to sign.
    Neither this object nor its derived key belongs in provider arguments or logs.
    """

    coordinates: RequestCoordinates
    derived_key: bytes = field(repr=False)
    eligible: bool = True
    routing_started: bool = False
    limiter_seen: bool = False
    limiter_running: bool = False


ACTIVE_REQUEST: ContextVar[RequestProof | None] = ContextVar("opencrane_preforward_request", default=None)


class LocalLimiterRejection(Exception):
    """Carry a real local limiter rejection to the same request's processor.

    The processor checks object identity and the pre-call state, not a public
    error name, HTTP status, or provider-controlled response header.
    """

    def __init__(self, owner: RequestProof, retry_at_epoch_ms: int):
        super().__init__("Local model request limit reached")
        self.owner = owner
        self.retry_at_epoch_ms = retry_at_epoch_ms


def capture_request(headers: list[tuple[bytes, bytes]], raw_body: bytes,
                    authenticated_key_hash: str | None, now_epoch_ms: int) -> RequestProof | None:
    """Accept bounded, unambiguous coordinates after the proxy authenticates the key.

    Matching the key hash is an additional binding check, not authentication.
    The processor must receive UserAPIKeyAuth from the upstream authenticated route.
    An unsupported request simply receives no recoverable rejection evidence.
    """
    names = ("authorization", CONTRACT_HEADER, NONCE_HEADER, FENCE_HEADER, DEADLINE_HEADER)
    selected = {name: [] for name in names}
    for name, value in headers:
        normalized = name.decode("latin-1").lower()
        if normalized in selected:
            selected[normalized].append(value.decode("latin-1"))
    if len(raw_body) > MAX_REQUEST_BYTES or any(len(values) != 1 for values in selected.values()):
        return None
    values = {name: matches[0] for name, matches in selected.items()}
    if values[CONTRACT_HEADER] != CONTRACT_VERSION:
        return None
    nonce, fence, deadline = values[NONCE_HEADER], values[FENCE_HEADER], values[DEADLINE_HEADER]
    if not HEX_64.fullmatch(nonce) or not HEX_64.fullmatch(fence):
        return None
    if not re.fullmatch(r"[1-9][0-9]{0,15}", deadline):
        return None
    deadline_epoch_ms = int(deadline)
    if not now_epoch_ms < deadline_epoch_ms <= min(MAX_SAFE_INTEGER, now_epoch_ms + MAX_REQUEST_LIFETIME_MS):
        return None
    authorization = values["authorization"]
    if not authorization.startswith("Bearer sk-"):
        return None
    token = authorization.removeprefix("Bearer ")
    if not re.fullmatch(r"[\x21-\x7e]{4,8192}", token):
        return None
    token_bytes = token.encode("ascii")
    if not isinstance(authenticated_key_hash, str) or not HEX_64.fullmatch(authenticated_key_hash):
        return None
    if not hmac.compare_digest(authenticated_key_hash, hashlib.sha256(token_bytes).hexdigest()):
        return None
    coordinates = RequestCoordinates(nonce, fence, hashlib.sha256(raw_body).hexdigest(), deadline_epoch_ms)
    derived_key = hmac.new(token_bytes, KEY_DOMAIN, hashlib.sha256).digest()
    return RequestProof(coordinates, derived_key)


def signed_receipt(proof: RequestProof, retry_at_epoch_ms: int) -> tuple[dict, str]:
    """Encode the closed receipt and authenticate every field with its private key."""
    coordinates = proof.coordinates
    receipt = {
        "version": CONTRACT_VERSION,
        "physicalNonce": coordinates.physical_nonce,
        "logicalFence": coordinates.logical_fence,
        "requestBodySha256": coordinates.request_body_sha256,
        "deadlineEpochMs": coordinates.deadline_epoch_ms,
        "retryAtEpochMs": retry_at_epoch_ms,
        "reason": "local-rate-limit",
    }
    canonical = json.dumps(receipt, sort_keys=True, separators=(",", ":")).encode("utf-8")
    mac = hmac.new(proof.derived_key, MESSAGE_DOMAIN + canonical, hashlib.sha256).hexdigest()
    return {"receipt": receipt}, mac
