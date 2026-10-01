"""Prepare one generation-fenced conversation computer for isolated review work."""

from __future__ import annotations

import json
import os
import threading
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Final

_HEALTH_PATH: Final = "/healthz"
_READINESS_PATH: Final = "/readyz"
_DEFAULT_TOKEN_PATH: Final = "/var/run/secrets/opencrane/token"
_DEFAULT_REVIEW_CREDENTIAL_PATH: Final = "/var/run/opencrane/review/credential"
_MAX_RESPONSE_BYTES: Final = 4 * 1024 * 1024
_AGENT_SANDBOX_REALIZATION: Final = "agent_sandbox"
_HOST_DEVELOPMENT_REALIZATION: Final = "host_development_process"


def _required(name: str) -> str:
    """Read one required lease coordinate and reject an empty value."""
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


def _configuration() -> dict[str, str]:
    """Freeze the private gateway and generation coordinates supplied by the sandbox template."""
    realization_kind = _required("OPENCRANE_COMPUTER_REALIZATION_KIND")
    if realization_kind not in {_AGENT_SANDBOX_REALIZATION, _HOST_DEVELOPMENT_REALIZATION}:
        raise RuntimeError("OPENCRANE_COMPUTER_REALIZATION_KIND is invalid")
    config = {
        "computerId": _required("OPENCRANE_COMPUTER_ID"),
        "generation": _required("OPENCRANE_COMPUTER_GENERATION"),
        "internalEndpoint": _required("OPENCRANE_INTERNAL_ENDPOINT").rstrip("/"),
        "leaseId": _required("OPENCRANE_COMPUTER_LEASE_ID"),
        "realizationKind": realization_kind,
    }
    if realization_kind == _HOST_DEVELOPMENT_REALIZATION:
        config.update({
            "processId": _required("OPENCRANE_COMPUTER_PROCESS_ID"),
            "readyPath": _required("OPENCRANE_HOST_READY_PATH"),
            "tokenPath": _required("OPENCRANE_HOST_BEARER_PATH"),
        })
        endpoint = urllib.parse.urlparse(config["internalEndpoint"])
        if (
            endpoint.scheme != "http"
            or endpoint.hostname not in {"127.0.0.1", "localhost"}
            or endpoint.username
            or endpoint.password
        ):
            raise RuntimeError("host development requires a loopback private endpoint")
        return config
    config.update({
        "reviewCredentialPath": os.environ.get("OPENCRANE_REVIEW_CREDENTIAL_PATH", _DEFAULT_REVIEW_CREDENTIAL_PATH),
        "tokenPath": os.environ.get("OPENCRANE_PROJECTED_TOKEN_PATH", _DEFAULT_TOKEN_PATH),
    })
    return config


def _read_token(path: str) -> str:
    """Read the rotating audience-bound token immediately before each server exchange."""
    token = Path(path).read_text(encoding="utf-8").strip()
    if not token:
        raise RuntimeError("projected workload token is empty")
    return token


def _json_request(url: str, token: str, payload: dict[str, Any] | None = None, empty_outcome: str | None = None) -> dict[str, Any]:
    """Perform one bounded authenticated JSON exchange with the private control-plane listener."""
    body = None if payload is None else json.dumps(payload, separators=(",", ":")).encode("utf-8")
    request = urllib.request.Request(url, data=body, method="GET" if body is None else "POST")
    request.add_header("Authorization", f"Bearer {token}")
    request.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(request, timeout=30) as response:
        raw = response.read(_MAX_RESPONSE_BYTES + 1)
    if len(raw) > _MAX_RESPONSE_BYTES:
        raise RuntimeError("private API response exceeds the computer byte limit")
    if not raw and empty_outcome is not None:
        return {"outcome": empty_outcome}
    value = json.loads(raw)
    if not isinstance(value, dict):
        raise RuntimeError("private API response must be an object")
    return value


def _lease_query(config: dict[str, str]) -> str:
    """Encode the immutable lease coordinates that every Pod-initiated GET exchange presents."""
    return urllib.parse.urlencode({"computerId": config["computerId"], "generation": config["generation"], "leaseId": config["leaseId"]})


def _install_review_credential(config: dict[str, str]) -> None:
    """Fetch the server-derived review secret once and place it where only the review surface reads it."""
    token = _read_token(config["tokenPath"])
    grant = _json_request(f"{config['internalEndpoint']}/api/internal/conversation-computer/review-credential?{_lease_query(config)}", token)
    credential = grant.get("reviewCredential")
    if not isinstance(credential, str) or not credential.strip():
        raise RuntimeError("review credential exchange returned no secret")
    target = Path(config["reviewCredentialPath"])
    target.parent.mkdir(parents=True, exist_ok=True)
    staging = target.with_name(f"{target.name}.tmp")
    descriptor = os.open(staging, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        handle.write(credential.strip())
    staging.replace(target)


def _restore(config: dict[str, str]) -> dict[str, Any]:
    """Ask the control plane to restore the exact checkpoint bound to this Pod lease."""
    token = _read_token(config["tokenPath"])
    payload = {
        "computerId": config["computerId"],
        "generation": int(config["generation"]),
        "leaseId": config["leaseId"],
    }
    return _json_request(f"{config['internalEndpoint']}/api/internal/conversation-computer/checkpoint/restore", token, payload, empty_outcome="absent")


def _start_review_surface() -> None:
    """Load and start the sandbox-only review surface after realization selection."""
    from review_surface.review_surface import start_review_surface

    start_review_surface()


def _prepare_sandbox() -> None:
    """Install the lease secret, open the review surface and restore the fenced workspace once."""
    config = _configuration()
    _install_review_credential(config)
    _start_review_surface()
    _restore(config)


def _publish_host_readiness(config: dict[str, str]) -> None:
    """Publish the exact process identity after host-only configuration has passed."""
    descriptor = os.open(config["readyPath"], os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        handle.write(config["processId"])


class _HealthHandler(BaseHTTPRequestHandler):
    """Serve process health without exposing an execution protocol."""

    server_version = "OpenCraneConversationComputer/0.11"

    def do_GET(self) -> None:
        """Return liveness or configuration readiness for the two fixed paths."""
        if self.path == _HEALTH_PATH:
            self._reply(200, {"status": "alive"})
            return
        if self.path == _READINESS_PATH:
            try:
                config = _configuration()
            except RuntimeError as error:
                self._reply(503, {"status": "not_ready", "reason": str(error)})
                return
            self._reply(200, {"status": "ready", "computerId": config["computerId"], "generation": config["generation"]})
            return
        self._reply(404, {"status": "not_found"})

    def log_message(self, _format: str, *args: object) -> None:
        """Suppress standard access logs because health requests contain no useful turn evidence."""

    def _reply(self, status: int, payload: dict[str, str]) -> None:
        """Write one bounded JSON health response."""
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main() -> None:
    """Prepare the sandbox once, then serve process health for the lease."""
    config = _configuration()
    if config["realizationKind"] == _HOST_DEVELOPMENT_REALIZATION:
        _publish_host_readiness(config)
        threading.Event().wait()
        return
    _prepare_sandbox()
    port = int(os.environ.get("OPENCRANE_COMPUTER_HEALTH_PORT", "8080"))
    server = ThreadingHTTPServer(("0.0.0.0", port), _HealthHandler)
    server.serve_forever()


if __name__ == "__main__":
    main()
