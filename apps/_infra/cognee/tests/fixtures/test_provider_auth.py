#!/usr/bin/env python3
"""Verify the disposable provider client and response-drop proxy authentication boundary."""

import json
import os
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from commit_then_drop_proxy import _Handler as DropProxyHandler
from evidence_summary import _validate_commit_then_drop
from provider_api import ProviderApi


class _ProviderHandler(BaseHTTPRequestHandler):
    requests: list[tuple[str, str, str | None]] = []

    def log_message(self, _format: str, *_args: object) -> None:
        return

    def _record(self) -> None:
        self.requests.append((self.command, self.path, self.headers.get("authorization")))

    def do_POST(self) -> None:
        length = int(self.headers.get("content-length", "0"))
        self.rfile.read(length)
        self._record()
        if self.path == "/api/v1/auth/register":
            self._respond(201, {"id": "synthetic-user"})
            return
        if self.path == "/api/v1/auth/login":
            self._respond(200, {"access_token": "test-bearer", "token_type": "bearer"})
            return
        if self.path in ("/api/v1/datasets", "/api/v1/add"):
            if self.headers.get("authorization") != "Bearer test-bearer":
                self._respond(401, {"detail": "Unauthorized"})
                return
            self._respond(200, {"id": "dataset"})
            return
        self._respond(404, {"detail": "Not found"})

    def _respond(self, status: int, value: dict[str, str]) -> None:
        body = json.dumps(value).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def _serve(handler: type[BaseHTTPRequestHandler]) -> tuple[ThreadingHTTPServer, threading.Thread]:
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, thread


class ProviderAuthenticationTest(unittest.TestCase):
    def setUp(self) -> None:
        _ProviderHandler.requests = []

    def test_register_login_and_authenticated_request_keep_token_in_memory(self) -> None:
        server, thread = _serve(_ProviderHandler)
        try:
            api = ProviderApi(f"http://127.0.0.1:{server.server_port}")
            api.authenticate("synthetic@example.com", "test-password", register=True)
            api.create_dataset("isolated")
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

        self.assertEqual(
            _ProviderHandler.requests,
            [
                ("POST", "/api/v1/auth/register", None),
                ("POST", "/api/v1/auth/login", None),
                ("POST", "/api/v1/datasets", "Bearer test-bearer"),
            ],
        )

    def test_recovery_login_does_not_register_again(self) -> None:
        server, thread = _serve(_ProviderHandler)
        try:
            api = ProviderApi(f"http://127.0.0.1:{server.server_port}")
            api.authenticate("synthetic@example.com", "test-password", register=False)
            api.create_dataset("recovered")
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

        self.assertEqual(
            [path for _, path, _ in _ProviderHandler.requests],
            ["/api/v1/auth/login", "/api/v1/datasets"],
        )

    def test_drop_proxy_forwards_bearer_without_recording_it(self) -> None:
        upstream, upstream_thread = _serve(_ProviderHandler)
        with tempfile.TemporaryDirectory() as directory:
            metadata = Path(directory) / "drop.jsonl"
            previous = {
                name: os.environ.get(name)
                for name in ("UPSTREAM_HOST", "UPSTREAM_PORT", "DROP_METADATA_LOG")
            }
            os.environ["UPSTREAM_HOST"] = "127.0.0.1"
            os.environ["UPSTREAM_PORT"] = str(upstream.server_port)
            os.environ["DROP_METADATA_LOG"] = str(metadata)
            proxy, proxy_thread = _serve(DropProxyHandler)
            try:
                api = ProviderApi("http://unused", "test-bearer")
                api.add_and_expect_dropped_response(
                    "127.0.0.1", proxy.server_port, "dataset", "source.txt", b"source"
                )
            finally:
                proxy.shutdown()
                proxy.server_close()
                proxy_thread.join()
                upstream.shutdown()
                upstream.server_close()
                upstream_thread.join()
                for name, value in previous.items():
                    if value is None:
                        os.environ.pop(name, None)
                    else:
                        os.environ[name] = value

            record = json.loads(metadata.read_text(encoding="utf-8"))
            self.assertEqual(
                record,
                {
                    "method": "POST",
                    "path": "/api/v1/add",
                    "responseDropped": True,
                    "upstreamStatus": 200,
                },
            )
            self.assertNotIn("test-bearer", metadata.read_text(encoding="utf-8"))
        self.assertEqual(_ProviderHandler.requests[-1][2], "Bearer test-bearer")

    def test_evidence_summary_requires_the_runner_owned_recovery_boundaries(self) -> None:
        records = [
            {"method": "POST", "path": "/api/v1/add", "upstreamStatus": 200, "responseDropped": True},
            {"method": "POST", "path": "/api/v1/cognify", "upstreamStatus": 200, "responseDropped": True},
        ]
        _validate_commit_then_drop(records[:1], ["/api/v1/add"])
        _validate_commit_then_drop(records, ["/api/v1/add", "/api/v1/cognify"])
        invalid = [
            (records, ["/api/v1/add"]),
            (records[:1], ["/api/v1/add", "/api/v1/cognify"]),
            ([records[0], records[0]], ["/api/v1/add", "/api/v1/cognify"]),
            ([records[0], {**records[1], "responseDropped": False}], ["/api/v1/add", "/api/v1/cognify"]),
            ([records[0], {**records[1], "authorization": "secret"}], ["/api/v1/add", "/api/v1/cognify"]),
        ]
        for value, expected in invalid:
            with self.subTest(value=value, expected=expected):
                with self.assertRaises(AssertionError):
                    _validate_commit_then_drop(value, expected)


if __name__ == "__main__":
    unittest.main()
