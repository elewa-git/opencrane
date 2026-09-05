"""Expose the bounded process boundary for one leased conversation computer."""

from __future__ import annotations

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Final

_HEALTH_PATH: Final = "/healthz"
_READINESS_PATH: Final = "/readyz"


def _required(name: str) -> str:
    """Read one required lease coordinate and reject an empty value."""
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


def _configuration() -> dict[str, str]:
    """Freeze the history and generation coordinates supplied by the sandbox template."""
    return {
        "computerId": _required("OPENCRANE_COMPUTER_ID"),
        "generation": _required("OPENCRANE_COMPUTER_GENERATION"),
        "historyEndpoint": _required("OPENCRANE_HISTORY_STORE_ENDPOINT"),
        "leaseId": _required("OPENCRANE_COMPUTER_LEASE_ID"),
    }


class _HealthHandler(BaseHTTPRequestHandler):
    """Serve process health without exposing a command or execution protocol."""

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
        """Suppress the standard access log until the computer observability adapter owns it."""

    def _reply(self, status: int, payload: dict[str, str]) -> None:
        """Write one bounded JSON health response."""
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main() -> None:
    """Start the health boundary on the fixed sandbox service port."""
    port = int(os.environ.get("OPENCRANE_COMPUTER_HEALTH_PORT", "8080"))
    server = ThreadingHTTPServer(("0.0.0.0", port), _HealthHandler)
    server.serve_forever()


if __name__ == "__main__":
    main()
