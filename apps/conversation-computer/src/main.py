"""Run generation-fenced conversation computer turns through the private server API."""

from __future__ import annotations

import json
import logging
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Final

_HEALTH_PATH: Final = "/healthz"
_READINESS_PATH: Final = "/readyz"
_DEFAULT_TOKEN_PATH: Final = "/var/run/secrets/opencrane/token"
_DEFAULT_REVIEW_CREDENTIAL_PATH: Final = "/var/run/opencrane/review/credential"
_AGENT_SANDBOX_REALIZATION: Final = "agent_sandbox"
_HOST_DEVELOPMENT_REALIZATION: Final = "host_development_process"
_MAX_RESPONSE_BYTES: Final = 4 * 1024 * 1024
_BOOTSTRAP_OUTCOMES: Final = frozenset({"ready", "pending", "response_unavailable"})
_MODEL_STEP_OUTCOMES: Final = frozenset({"completed", "pending", "response_unavailable", "authority_ended"})
_DEGRADED_OUTCOMES: Final = frozenset({"response_unavailable", "authority_ended"})
_LOGGER = logging.getLogger("opencrane.conversation-computer")
_LAST_FAILURE_TYPE: str | None = None


def _required(name: str) -> str:
    """Read one required lease coordinate and reject an empty value."""
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


def _configuration() -> dict[str, str]:
    """Read lease coordinates and mode-specific bearer paths before any worker starts."""
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
        config["processId"] = _required("OPENCRANE_COMPUTER_PROCESS_ID")
        config["readyPath"] = _required("OPENCRANE_HOST_READY_PATH")
        config["tokenPath"] = _required("OPENCRANE_HOST_BEARER_PATH")
        endpoint = urllib.parse.urlparse(config["internalEndpoint"])
        if endpoint.scheme != "http" or endpoint.hostname not in {"127.0.0.1", "localhost"} or endpoint.username or endpoint.password:
            raise RuntimeError("host development requires a loopback private endpoint")
    else:
        config["reviewCredentialPath"] = os.environ.get("OPENCRANE_REVIEW_CREDENTIAL_PATH", _DEFAULT_REVIEW_CREDENTIAL_PATH)
        config["tokenPath"] = os.environ.get("OPENCRANE_PROJECTED_TOKEN_PATH", _DEFAULT_TOKEN_PATH)
    return config


def _read_token(path: str) -> str:
    """Read the mode-specific private bearer immediately before each server exchange."""
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
    """Encode the lease coordinates that every process-initiated GET exchange presents."""
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


def _bootstrap(config: dict[str, str]) -> dict[str, Any]:
    """Read the current turn's status without receiving model input or credentials."""
    token = _read_token(config["tokenPath"])
    result = _json_request(f"{config['internalEndpoint']}/api/internal/conversation-computer/bootstrap?{_lease_query(config)}", token, empty_outcome="idle")
    if result == {"outcome": "idle"}:
        return result
    outcome = result.get("outcome")
    if set(result) != {"bootstrapId", "outcome"} or not isinstance(outcome, str) or outcome not in _BOOTSTRAP_OUTCOMES:
        raise RuntimeError("bootstrap returned an invalid turn status")
    _bootstrap_id(result)
    return result


def _restore(config: dict[str, str]) -> dict[str, Any]:
    """Ask the control plane to restore the checkpoint bound to this Agent Sandbox lease."""
    token = _read_token(config["tokenPath"])
    payload = {
        "computerId": config["computerId"],
        "generation": int(config["generation"]),
        "leaseId": config["leaseId"],
    }
    return _json_request(f"{config['internalEndpoint']}/api/internal/conversation-computer/checkpoint/restore", token, payload, empty_outcome="absent")


def _bootstrap_id(bootstrap: dict[str, Any]) -> str:
    """Require the server's exact non-empty idempotency coordinate."""
    bootstrap_id = bootstrap.get("bootstrapId")
    if not isinstance(bootstrap_id, str) or not bootstrap_id or bootstrap_id != bootstrap_id.strip():
        raise RuntimeError("bootstrap omitted its idempotency coordinate")
    return bootstrap_id


def _execute_turn(config: dict[str, str], bootstrap: dict[str, Any]) -> str:
    """Ask the server to advance or recover the conversation's reserved work."""
    if bootstrap.get("outcome") != "ready":
        raise RuntimeError("model step requires a ready bootstrap")
    payload = {"bootstrapId": _bootstrap_id(bootstrap)}
    token = _read_token(config["tokenPath"])
    result = _json_request(f"{config['internalEndpoint']}/api/internal/conversation-computer/model-step", token, payload)
    outcome = result.get("outcome")
    if set(result) != {"outcome"} or not isinstance(outcome, str) or outcome not in _MODEL_STEP_OUTCOMES:
        raise RuntimeError("model step returned an invalid outcome")
    return outcome


def _turn_loop(config: dict[str, str] | None = None) -> None:
    """Run mode-specific setup, then poll for the single pending activation."""
    global _LAST_FAILURE_TYPE
    config = config or _configuration()
    host_development = config["realizationKind"] == _HOST_DEVELOPMENT_REALIZATION
    credentialed = host_development
    restored = host_development
    stopped_bootstrap: str | None = None
    stopped_outcome: str | None = None
    retry_delay_seconds = 2
    while True:
        try:
            if not credentialed:
                _install_review_credential(config)
                credentialed = True
            if not restored:
                _restore(config)
                restored = True
            bootstrap = _bootstrap(config)
            outcome = bootstrap["outcome"]
            if bootstrap.get("bootstrapId") == stopped_bootstrap and stopped_outcome is not None:
                outcome = stopped_outcome
            elif outcome == "ready":
                outcome = _execute_turn(config, bootstrap)
            if outcome in _DEGRADED_OUTCOMES:
                stopped_bootstrap = _bootstrap_id(bootstrap)
                stopped_outcome = outcome
                if _LAST_FAILURE_TYPE != outcome:
                    _LOGGER.warning("conversation computer turn needs recovery", extra={"errorType": outcome})
                _LAST_FAILURE_TYPE = outcome
            else:
                stopped_bootstrap = None
                stopped_outcome = None
                _LAST_FAILURE_TYPE = None
            retry_delay_seconds = 2
        except (OSError, RuntimeError, ValueError, urllib.error.URLError, json.JSONDecodeError) as error:
            _LAST_FAILURE_TYPE = stopped_outcome or type(error).__name__
            _LOGGER.warning("conversation computer turn retry", extra={"errorType": type(error).__name__, "retryDelaySeconds": retry_delay_seconds})
            retry_delay_seconds = min(retry_delay_seconds * 2, 30)
        time.sleep(retry_delay_seconds)


class _HealthHandler(BaseHTTPRequestHandler):
    """Serve process health without exposing an execution protocol."""

    server_version = "OpenCraneConversationComputer/0.11"

    def do_GET(self) -> None:
        """Return liveness or configuration readiness for the two fixed paths."""
        if self.path == _HEALTH_PATH:
            self._reply(200, {"status": "alive"})
            return
        if self.path == _READINESS_PATH:
            if _LAST_FAILURE_TYPE is not None:
                self._reply(503, {"status": "degraded", "reason": _LAST_FAILURE_TYPE})
                return
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


def _publish_host_readiness(config: dict[str, str]) -> None:
    """Tell the parent that host configuration passed before entering the work loop."""
    descriptor = os.open(config["readyPath"], os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        handle.write(config["processId"])


def main() -> None:
    """Run host work directly or start production work beside the health listener."""
    config = _configuration()
    if config["realizationKind"] == _HOST_DEVELOPMENT_REALIZATION:
        _publish_host_readiness(config)
        _turn_loop(config)
        return
    from review_surface.review_surface import start_review_surface

    start_review_surface()
    worker = threading.Thread(target=_turn_loop, name="conversation-turn", daemon=True)
    worker.start()
    port = int(os.environ.get("OPENCRANE_COMPUTER_HEALTH_PORT", "8080"))
    server = ThreadingHTTPServer(("0.0.0.0", port), _HealthHandler)
    server.serve_forever()


if __name__ == "__main__":
    main()
