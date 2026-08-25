"""Fail-closed bootstrap acknowledgement client shared by governed skill-worker images."""

import json
import os
import sys
from typing import Callable, Protocol
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener


_EXPECTED_BASE_PATH = "/api/internal/agent-runtime"
_MAX_FILE_BYTES = 4096
_MAX_RESPONSE_BYTES = 4096


class _Response(Protocol):
    """Minimal response surface retained for dependency-free test injection."""

    status: int

    def read(self) -> bytes:
        """Read the bounded acknowledgement response."""


class _NoRedirect(HTTPRedirectHandler):
    """Reject redirects so a worker cannot follow a changed authority."""

    def redirect_request(self, request: Request, fp: object, code: int, message: str, headers: object, newurl: str) -> None:
        """Return no replacement request for an unexpected redirect."""
        return None


def _required_environment(name: str) -> str:
    """Read one required value without logging the value itself."""
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} must be configured")
    return value


def _read_single_line(path: str, label: str) -> str:
    """Read one bounded projected file without echoing its contents."""
    with open(path, "r", encoding="utf-8") as source:
        value = source.read(_MAX_FILE_BYTES + 1).strip()
    if not value or len(value.encode("utf-8")) > _MAX_FILE_BYTES or "\n" in value or "\r" in value:
        raise RuntimeError(f"projected {label} is unavailable")
    return value


def _acknowledgement_url(base_url: str) -> str:
    """Validate the deployment-owned service URL before deriving the one legal endpoint."""
    parsed = urlparse(base_url)
    try:
        port = parsed.port
    except ValueError as error:
        raise RuntimeError("bootstrap endpoint is invalid") from error
    if parsed.scheme != "http" or not parsed.hostname or not parsed.hostname.endswith(".svc.cluster.local") or port is None or not 1 <= port <= 65535 or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path != _EXPECTED_BASE_PATH:
        raise RuntimeError("bootstrap endpoint is invalid")
    return f"{base_url}/skill-authoring-validations:bootstrap"


def _open(request: Request, timeout: float) -> _Response:
    """Open one request while refusing redirect-based authority changes."""
    return build_opener(_NoRedirect()).open(request, timeout=timeout)  # type: ignore[return-value]


def acknowledge(base_url: str, token_path: str, reference_path: str, open_request: Callable[[Request, float], _Response] = _open) -> str:
    """Consume one opaque bootstrap reference and return only its server-bound validation coordinate."""
    token = _read_single_line(token_path, "capability token")
    reference = _read_single_line(reference_path, "bootstrap reference")
    if len(reference) != 83 or not reference.startswith("skill-bootstrap-v1_") or any(character not in "0123456789abcdef" for character in reference.removeprefix("skill-bootstrap-v1_")):
        raise RuntimeError("projected bootstrap reference is invalid")
    request = Request(_acknowledgement_url(base_url), data=json.dumps({"bootstrapReference": reference}, separators=(",", ":")).encode("utf-8"), headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json", "Accept": "application/json"}, method="POST")
    try:
        response = open_request(request, 10.0)
        payload_bytes = response.read()
        if len(payload_bytes) > _MAX_RESPONSE_BYTES:
            raise RuntimeError("bootstrap acknowledgement was rejected")
        payload = json.loads(payload_bytes.decode("utf-8"))
    except HTTPError as error:
        try:
            raise RuntimeError(f"bootstrap acknowledgement was denied ({error.code})") from error
        finally:
            error.close()
    except (OSError, URLError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RuntimeError("bootstrap acknowledgement is unavailable") from error
    if response.status != 200 or not isinstance(payload, dict) or set(payload) != {"acknowledged", "validationId"} or payload.get("acknowledged") is not True or not _validation_id(payload.get("validationId")):
        raise RuntimeError("bootstrap acknowledgement was rejected")
    return payload["validationId"]


def _validation_id(value: object) -> bool:
    """Accept the bounded opaque coordinate required by the later validation input and completion calls."""
    return isinstance(value, str) and 0 < len(value) <= 256 and not any(character in value for character in "\x00\n\r")


def main() -> int:
    """Run the only worker action currently permitted by the governed Job contract."""
    try:
        acknowledge(_required_environment("OPENCRANE_SKILL_BOOTSTRAP_URL"), _required_environment("OPENCRANE_SKILL_TOKEN_PATH"), _required_environment("OPENCRANE_SKILL_BOOTSTRAP_REFERENCE_PATH"))
    except RuntimeError as error:
        print(json.dumps({"component": "governed-skill-worker", "event": "bootstrap_failed", "reason": str(error)}, sort_keys=True), file=sys.stderr, flush=True)
        return 1
    print(json.dumps({"component": "governed-skill-worker", "event": "bootstrap_acknowledged"}, sort_keys=True), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
