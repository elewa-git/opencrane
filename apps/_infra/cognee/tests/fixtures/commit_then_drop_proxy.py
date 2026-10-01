#!/usr/bin/env python3
"""Forward one admitted provider mutation, then drop its successful response."""

import http.client
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class _Handler(BaseHTTPRequestHandler):
    """Drop responses only after the upstream provider has completed them."""

    server_version = "OpenCraneCommitThenDrop/1"

    def log_message(self, _format: str, *_args: object) -> None:
        return

    def do_GET(self) -> None:
        if self.path == "/health":
            body = b'{"status":"ok"}'
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        self.send_error(404)

    def do_POST(self) -> None:
        if self.path not in ("/api/v1/add", "/api/v1/cognify"):
            self.send_error(404)
            return
        length = int(self.headers.get("content-length", "0"))
        payload = self.rfile.read(length)
        connection = http.client.HTTPConnection(
            os.environ.get("UPSTREAM_HOST", "cognee"),
            int(os.environ.get("UPSTREAM_PORT", "8000")),
            timeout=600 if self.path == "/api/v1/cognify" else 300,
        )
        forwarded_headers = {
            "accept": "application/json",
            "content-type": self.headers.get("content-type", "application/octet-stream"),
            "content-length": str(len(payload)),
        }
        authorization = self.headers.get("authorization")
        if authorization is not None:
            forwarded_headers["authorization"] = authorization
        connection.request("POST", self.path, body=payload, headers=forwarded_headers)
        response = connection.getresponse()
        response.read()
        status = response.status
        connection.close()
        if status < 200 or status >= 300:
            self.send_error(502)
            return
        record = {"method": "POST", "path": self.path, "upstreamStatus": status, "responseDropped": True}
        with Path(os.environ["DROP_METADATA_LOG"]).open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(record, sort_keys=True) + "\n")
        self.close_connection = True


def main() -> None:
    os.umask(0o077)
    server = ThreadingHTTPServer(("0.0.0.0", int(os.environ.get("DROP_PORT", "8091"))), _Handler)
    server.serve_forever()


if __name__ == "__main__":
    main()
