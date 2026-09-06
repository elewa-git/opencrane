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
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Final

from review_surface.review_surface import start_review_surface

_HEALTH_PATH: Final = "/healthz"
_READINESS_PATH: Final = "/readyz"
_DEFAULT_TOKEN_PATH: Final = "/var/run/secrets/opencrane/token"
_DEFAULT_REVIEW_CREDENTIAL_PATH: Final = "/var/run/opencrane/review/credential"
_MAX_RESPONSE_BYTES: Final = 4 * 1024 * 1024
_LOGGER = logging.getLogger("opencrane.conversation-computer")
_LAST_FAILURE_TYPE: str | None = None


def _required(name: str) -> str:
    """Read one required lease coordinate and reject an empty value."""
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


def _configuration() -> dict[str, str]:
    """Freeze the private gateway and generation coordinates supplied by the sandbox template."""
    return {
        "computerId": _required("OPENCRANE_COMPUTER_ID"),
        "generation": _required("OPENCRANE_COMPUTER_GENERATION"),
        "internalEndpoint": _required("OPENCRANE_INTERNAL_ENDPOINT").rstrip("/"),
        "leaseId": _required("OPENCRANE_COMPUTER_LEASE_ID"),
        "reviewCredentialPath": os.environ.get("OPENCRANE_REVIEW_CREDENTIAL_PATH", _DEFAULT_REVIEW_CREDENTIAL_PATH),
        "tokenPath": os.environ.get("OPENCRANE_PROJECTED_TOKEN_PATH", _DEFAULT_TOKEN_PATH),
    }


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


def _bootstrap(config: dict[str, str]) -> dict[str, Any]:
    """Exchange the Pod-bound token and immutable lease coordinates for one admitted turn."""
    token = _read_token(config["tokenPath"])
    return _json_request(f"{config['internalEndpoint']}/api/internal/conversation-computer/bootstrap?{_lease_query(config)}", token, empty_outcome="idle")


def _restore(config: dict[str, str]) -> dict[str, Any]:
    """Ask the control plane to restore the exact checkpoint bound to this Pod lease."""
    token = _read_token(config["tokenPath"])
    payload = {
        "computerId": config["computerId"],
        "generation": int(config["generation"]),
        "leaseId": config["leaseId"],
    }
    return _json_request(f"{config['internalEndpoint']}/api/internal/conversation-computer/checkpoint/restore", token, payload, empty_outcome="absent")


def _model_text(response: dict[str, Any]) -> str:
    """Extract only the first assistant text returned by the admitted OpenAI-compatible route."""
    choices = response.get("choices")
    if not isinstance(choices, list) or not choices:
        raise RuntimeError("model response has no choice")
    first = choices[0]
    message = first.get("message") if isinstance(first, dict) else None
    content = message.get("content") if isinstance(message, dict) else None
    if not isinstance(content, str) or not content.strip():
        raise RuntimeError("model response has no assistant text")
    return content


def _execute_turn(config: dict[str, str], bootstrap: dict[str, Any]) -> None:
    """Call the admitted model route and return untrusted assistant text for server-side storage."""
    compiled = bootstrap.get("compiledInput")
    credential = bootstrap.get("modelCredential")
    if not isinstance(compiled, dict) or not isinstance(credential, dict):
        raise RuntimeError("bootstrap omitted compiled input or model credential")
    endpoint = credential.get("endpoint")
    key = credential.get("key")
    model = credential.get("model")
    messages = compiled.get("messages")
    route = compiled.get("model")
    budget = compiled.get("budget")
    if not isinstance(endpoint, str) or not isinstance(key, str) or not isinstance(model, str) or not isinstance(messages, list) or not isinstance(route, dict) or not isinstance(budget, dict):
        raise RuntimeError("bootstrap contains an invalid model route")
    max_model_turns = budget.get("maxModelTurns")
    if not isinstance(max_model_turns, int) or isinstance(max_model_turns, bool) or max_model_turns < 1:
        raise RuntimeError("compiled budget does not admit a model turn")
    output_limit = route.get("maxOutputTokens")
    completion_limit = budget.get("maxCompletionTokens")
    limits = [limit for limit in (output_limit, completion_limit) if isinstance(limit, int) and not isinstance(limit, bool) and limit > 0]
    request = {"model": model, "messages": messages}
    if limits:
        request["max_tokens"] = min(limits)
    model_response = _json_request(f"{endpoint.rstrip('/')}/v1/chat/completions", key, request)
    text = _model_text(model_response)
    token = _read_token(config["tokenPath"])
    bootstrap_id = bootstrap.get("bootstrapId")
    if not isinstance(bootstrap_id, str) or not bootstrap_id:
        raise RuntimeError("bootstrap omitted its idempotency coordinate")
    source_command_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"opencrane:conversation-output:{bootstrap_id}"))
    output = {"bootstrapId": bootstrap_id, "sourceCommandId": source_command_id, "text": text}
    _json_request(f"{config['internalEndpoint']}/api/internal/conversation-computer/output", token, output)


def _turn_loop() -> None:
    """Install the review secret, restore the workspace, then poll for the single pending activation."""
    global _LAST_FAILURE_TYPE
    config = _configuration()
    credentialed = False
    restored = False
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
            if bootstrap.get("outcome") == "ready":
                _execute_turn(config, bootstrap)
            _LAST_FAILURE_TYPE = None
            retry_delay_seconds = 2
        except (OSError, RuntimeError, ValueError, urllib.error.URLError, json.JSONDecodeError) as error:
            _LAST_FAILURE_TYPE = type(error).__name__
            _LOGGER.warning("conversation computer turn retry", extra={"errorType": _LAST_FAILURE_TYPE, "retryDelaySeconds": retry_delay_seconds})
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


def main() -> None:
    """Start the private turn worker beside the fixed health listener."""
    start_review_surface()
    worker = threading.Thread(target=_turn_loop, name="conversation-turn", daemon=True)
    worker.start()
    port = int(os.environ.get("OPENCRANE_COMPUTER_HEALTH_PORT", "8080"))
    server = ThreadingHTTPServer(("0.0.0.0", port), _HealthHandler)
    server.serve_forever()


if __name__ == "__main__":
    main()
