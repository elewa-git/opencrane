"""Expose the tiny local readiness surface used to claim a warm runtime Pod."""

import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class _WarmReadinessHandler(BaseHTTPRequestHandler):
    """Answer only the two fixed warm readiness paths without logging request data."""

    pod_uid = ""
    claimed_profile = ""

    def do_GET(self) -> None:
        """Return readiness for the generic probe or the controller's claimed-path proof."""
        if self.path == "/internal/warm-runtime/generic-readiness":
            self.send_response(204)
            self.end_headers()
            return
        if (
            self.path == "/internal/warm-runtime/readiness"
            and self.headers.get("x-opencrane-pod-uid") == self.pod_uid
            and self.headers.get("x-opencrane-runtime-profile") == self.claimed_profile
        ):
            self.send_response(204)
            self.end_headers()
            return
        self.send_response(404)
        self.end_headers()

    def log_message(self, _format: str, *_args: object) -> None:
        """Suppress the standard HTTP server's unstructured request logging."""


def start_warm_readiness_server(port: int, pod_uid: str, claimed_profile: str) -> ThreadingHTTPServer:
    """Start the readiness listener before this process asks the server for a claim."""
    if port < 1024 or port > 65535 or not pod_uid or not claimed_profile:
        raise RuntimeError("warm readiness requires a bounded port, Pod UID, and claimed profile")
    handler = type(
        "WarmReadinessHandler",
        (_WarmReadinessHandler,),
        {"pod_uid": pod_uid, "claimed_profile": claimed_profile},
    )
    server = ThreadingHTTPServer(("0.0.0.0", port), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server
