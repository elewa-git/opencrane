"""Serve a lease-local review surface without granting a shell or public ingress."""

from __future__ import annotations

import hmac
import io
import json
import os
import selectors
import shutil
import signal
import subprocess
import tarfile
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Final

from review_surface.browser_surface import browser_metadata, capture_preview, open_browser_page, start_browser

_MAX_BODY_BYTES: Final = 64 * 1024
_MAX_OUTPUT_BYTES: Final = 1024 * 1024
_MAX_CHECKPOINT_BYTES: Final = 64 * 1024 * 1024
_DEFAULT_COMMANDS: Final = ("git", "node", "npm", "npx", "python3")


@dataclass(frozen=True)
class ReviewSurfaceConfig:
    """Freeze the workspace, credential and preview boundaries for one computer lease."""

    workspace: Path
    credential_path: Path
    command_names: frozenset[str]
    preview_ports: frozenset[int]
    host: str = "0.0.0.0"
    port: int = 8090


def _configuration() -> ReviewSurfaceConfig:
    """Read the release-owned review surface policy from the sandbox template."""
    workspace = Path(os.environ.get("OPENCRANE_WORKSPACE_PATH", "/workspace")).resolve()
    credential_path = Path(os.environ.get("OPENCRANE_REVIEW_CREDENTIAL_PATH", "/var/run/opencrane/review/credential"))
    command_names = frozenset(filter(None, os.environ.get("OPENCRANE_REVIEW_COMMANDS", ",".join(_DEFAULT_COMMANDS)).split(",")))
    preview_values = filter(None, os.environ.get("OPENCRANE_PREVIEW_PORTS", "3000,4173,4200,5173,8000").split(","))
    preview_ports = frozenset(int(value) for value in preview_values)
    if any(port < 1024 or port > 65535 for port in preview_ports):
        raise RuntimeError("preview ports must be unprivileged TCP ports")
    return ReviewSurfaceConfig(workspace, credential_path, command_names, preview_ports)


def _workspace_path(config: ReviewSurfaceConfig, requested: str) -> Path:
    """Resolve one caller-selected relative path without following it outside the workspace."""
    if not requested or Path(requested).is_absolute():
        raise ValueError("path must be relative to the workspace")
    workspace = config.workspace.resolve()
    resolved = (workspace / requested).resolve()
    if resolved != workspace and workspace not in resolved.parents:
        raise ValueError("path leaves the workspace")
    return resolved


def _read_bounded(path: Path) -> bytes:
    """Read one regular workspace file while enforcing the review response ceiling."""
    if not path.is_file():
        raise ValueError("path must name a regular file")
    with path.open("rb") as source:
        value = source.read(_MAX_OUTPUT_BYTES + 1)
    if len(value) > _MAX_OUTPUT_BYTES:
        raise ValueError("file exceeds the review response limit")
    return value


def _run_command(config: ReviewSurfaceConfig, payload: dict[str, Any]) -> dict[str, Any]:
    """Run one argv-only command inside the workspace and return bounded combined output."""
    if set(payload) not in ({"argv"}, {"argv", "cwd"}):
        raise ValueError("command body contains unsupported fields")
    argv = payload.get("argv")
    cwd_value = payload.get("cwd", ".")
    if not isinstance(argv, list) or not argv or not all(isinstance(value, str) and value for value in argv):
        raise ValueError("argv must be a non-empty string array")
    command_name = Path(argv[0]).name
    if argv[0] != command_name or command_name not in config.command_names:
        raise ValueError("command is not release-allowlisted")
    if not isinstance(cwd_value, str):
        raise ValueError("cwd must be a relative string")
    cwd = _workspace_path(config, cwd_value)
    if not cwd.is_dir():
        raise ValueError("cwd must name a workspace directory")
    environment = {"HOME": "/tmp", "LANG": "C.UTF-8", "PATH": "/usr/local/bin:/usr/bin:/bin"}
    # Running reviewer-chosen argv is this surface's purpose: the binary must be on the release
    # allowlist, there is no shell, the cwd is fenced to the workspace, and the caller already
    # proved the per-lease review credential inside a gVisor sandbox.
    process = subprocess.Popen(argv, cwd=cwd, env=environment, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True)  # codeql[py/command-line-injection] allowlisted argv, no shell, workspace-fenced cwd
    output, outcome, truncated = _bounded_process_output(process)
    return {"exitCode": process.returncode if outcome == "completed" else None, "outcome": outcome, "output": output.decode("utf-8", errors="replace"), "truncated": truncated}


def _bounded_process_output(process: subprocess.Popen[bytes]) -> tuple[bytes, str, bool]:
    """Drain one process without buffering beyond the response ceiling or leaving descendants alive."""
    if process.stdout is None:
        raise RuntimeError("command output pipe is unavailable")
    deadline = time.monotonic() + 30
    chunks: list[bytes] = []
    length = 0
    outcome = "completed"
    selector = selectors.DefaultSelector()
    selector.register(process.stdout, selectors.EVENT_READ)
    # Read until the pipe reaches end of file, not until the child exits: a fast command can finish
    # before the first read and its output must still be drained, while a lingering descendant that
    # keeps the pipe open runs into the deadline and is killed with the whole session below.
    drained = False
    while not drained:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            outcome = "timed_out"
            break
        events = selector.select(min(remaining, 0.25))
        for key, _ in events:
            chunk = os.read(key.fd, min(64 * 1024, _MAX_OUTPUT_BYTES + 1 - length))
            if not chunk:
                drained = True
                continue
            chunks.append(chunk)
            length += len(chunk)
            if length > _MAX_OUTPUT_BYTES:
                outcome = "output_limited"
                break
        if outcome != "completed":
            break
    if outcome != "completed":
        os.killpg(process.pid, signal.SIGKILL)
    process.wait(timeout=2)
    selector.close()
    process.stdout.close()
    return b"".join(chunks)[:_MAX_OUTPUT_BYTES], outcome, length > _MAX_OUTPUT_BYTES


def _git_diff(config: ReviewSurfaceConfig, requested: str) -> dict[str, Any]:
    """Return a bounded no-ext-diff view for one selected workspace path."""
    selected = _workspace_path(config, requested)
    relative = selected.relative_to(config.workspace.resolve()).as_posix()
    payload = {"argv": ["git", "diff", "--no-ext-diff", "--", relative], "cwd": "."}
    return _run_command(config, payload)


def _preview(config: ReviewSurfaceConfig, port: int, path: str) -> tuple[int, str, bytes]:
    """Fetch one allowlisted loopback preview without forwarding caller headers or redirects."""
    if port not in config.preview_ports:
        raise ValueError("preview port is not release-allowlisted")
    request = urllib.request.Request(f"http://127.0.0.1:{port}/{path.lstrip('/')}", method="GET")
    opener = urllib.request.build_opener(_NoRedirectHandler())
    try:
        with opener.open(request, timeout=5) as response:
            body = response.read(_MAX_OUTPUT_BYTES + 1)
            status = response.status
            content_type = response.headers.get_content_type()
    except urllib.error.HTTPError as error:
        body = error.read(_MAX_OUTPUT_BYTES + 1)
        status = error.code
        content_type = error.headers.get_content_type()
    if len(body) > _MAX_OUTPUT_BYTES:
        raise ValueError("preview response exceeds the review limit")
    return status, content_type, body


def _capture_checkpoint(config: ReviewSurfaceConfig) -> bytes:
    """Archive the workspace without following links or exceeding the fixed checkpoint ceiling."""
    with tempfile.SpooledTemporaryFile(max_size=_MAX_CHECKPOINT_BYTES) as output:
        with tarfile.open(fileobj=output, mode="w:gz", dereference=False) as archive:
            for path in sorted(config.workspace.rglob("*")):
                relative = path.relative_to(config.workspace)
                if path.is_symlink():
                    continue
                archive.add(path, arcname=relative.as_posix(), recursive=False)
                if output.tell() > _MAX_CHECKPOINT_BYTES:
                    raise ValueError("workspace checkpoint exceeds the byte limit")
        if output.tell() > _MAX_CHECKPOINT_BYTES:
            raise ValueError("workspace checkpoint exceeds the byte limit")
        output.seek(0)
        return output.read()


def _restore_checkpoint(config: ReviewSurfaceConfig, body: bytes) -> None:
    """Replace workspace contents from one confined tar archive after validating every member."""
    if not body or len(body) > _MAX_CHECKPOINT_BYTES:
        raise ValueError("workspace checkpoint exceeds the byte limit")
    with tempfile.TemporaryDirectory(dir=config.workspace.parent) as staging_value:
        staging = Path(staging_value).resolve()
        with tarfile.open(fileobj=io.BytesIO(body), mode="r:gz") as archive:
            members = archive.getmembers()
            total = 0
            for member in members:
                target = (staging / member.name).resolve()
                if target != staging and staging not in target.parents:
                    raise ValueError("workspace checkpoint contains an escaping path")
                if member.issym() or member.islnk() or not (member.isfile() or member.isdir()):
                    raise ValueError("workspace checkpoint contains an unsupported entry")
                total += member.size
                if total > _MAX_CHECKPOINT_BYTES:
                    raise ValueError("workspace checkpoint expands beyond the byte limit")
            archive.extractall(staging, members=members, filter="data")
        for existing in config.workspace.iterdir():
            if existing.is_dir() and not existing.is_symlink():
                shutil.rmtree(existing)
            else:
                existing.unlink()
        for restored in staging.iterdir():
            restored.replace(config.workspace / restored.name)


class _NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Refuse redirects so a preview cannot pivot the gateway to another destination."""

    def redirect_request(self, request: urllib.request.Request, file_pointer: Any, code: int, message: str, headers: Any, new_url: str) -> None:
        """Stop urllib from following a preview response location."""
        return None


class _ReviewHandler(BaseHTTPRequestHandler):
    """Expose only authenticated, bounded review operations on the loopback listener."""

    server_version = "OpenCraneReviewSurface/0.11"

    def do_GET(self) -> None:
        """Serve a selected file, diff or allowlisted localhost preview."""
        if not self._authenticated():
            self._json(401, {"error": "unauthorized"})
            return
        path, _, query = self.path.partition("?")
        parameters = urllib.parse.parse_qs(query, keep_blank_values=True)
        try:
            if path == "/v1/files":
                selected = parameters.get("path", [""])[0]
                body = _read_bounded(_workspace_path(self.server.config, selected))
                self._bytes(200, "application/octet-stream", body)
                return
            if path == "/v1/diff":
                selected = parameters.get("path", [""])[0]
                self._json(200, _git_diff(self.server.config, selected))
                return
            if path == "/v1/checkpoints/capture":
                self._bytes(200, "application/vnd.opencrane.workspace-tar+gzip", _capture_checkpoint(self.server.config))
                return
            if path.startswith("/v1/previews/"):
                remainder = path.removeprefix("/v1/previews/")
                port_value, preview_separator, preview_path = remainder.partition("/")
                if not port_value.isdigit() or not preview_separator:
                    raise ValueError("preview route requires a port and path")
                status, content_type, body = _preview(self.server.config, int(port_value), preview_path)
                self._bytes(status, content_type, body)
                return
            if path in ("/v1/browser/version", "/v1/browser/targets"):
                kind = "version" if path.endswith("version") else "list"
                content_type, body = browser_metadata(kind)
                self._bytes(200, content_type, body)
                return
            self._json(404, {"error": "not_found"})
        except (OSError, ValueError) as error:
            self._json(400, {"error": str(error)})

    def do_POST(self) -> None:
        """Run a command, browser operation, or bounded workspace restoration."""
        if not self._authenticated():
            self._json(401, {"error": "unauthorized"})
            return
        if self.path == "/v1/checkpoints/restore":
            self._restore_checkpoint()
            return
        if self.path != "/v1/commands":
            if self.path == "/v1/browser/pages":
                self._open_browser_page()
                return
            if self.path == "/v1/browser/screenshots":
                self._capture_browser_preview()
                return
            self._json(404, {"error": "not_found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > _MAX_BODY_BYTES:
                raise ValueError("command body exceeds the request limit")
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload, dict):
                raise ValueError("command body must be an object")
            self._json(200, _run_command(self.server.config, payload))
        except (json.JSONDecodeError, OSError, ValueError) as error:
            self._json(400, {"error": str(error)})

    def _restore_checkpoint(self) -> None:
        """Accept one exact-length checkpoint archive under the current review credential."""
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > _MAX_CHECKPOINT_BYTES:
                raise ValueError("workspace checkpoint exceeds the byte limit")
            body = self.rfile.read(length)
            if len(body) != length:
                raise ValueError("workspace checkpoint length does not match its request")
            _restore_checkpoint(self.server.config, body)
            self._json(200, {"outcome": "restored"})
        except (OSError, tarfile.TarError, ValueError) as error:
            self._json(400, {"error": str(error)})

    def _open_browser_page(self) -> None:
        """Open one localhost-only browser target selected from the release preview ports."""
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > _MAX_BODY_BYTES:
                raise ValueError("browser body exceeds the request limit")
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload, dict) or set(payload) != {"path", "port"} or not isinstance(payload["path"], str) or not isinstance(payload["port"], int):
                raise ValueError("browser body requires only an integer port and string path")
            body = open_browser_page(payload["port"], payload["path"], self.server.config.preview_ports)
            self._bytes(201, "application/json", body)
        except (json.JSONDecodeError, OSError, ValueError, urllib.error.URLError) as error:
            self._json(400, {"error": str(error)})

    def _capture_browser_preview(self) -> None:
        """Render one localhost-only preview through pinned Chromium and return bounded PNG bytes."""
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > _MAX_BODY_BYTES:
                raise ValueError("browser body exceeds the request limit")
            payload = json.loads(self.rfile.read(length))
            expected = {"height", "path", "port", "width"}
            if not isinstance(payload, dict) or set(payload) != expected or not isinstance(payload["path"], str) or not all(isinstance(payload[name], int) for name in ("height", "port", "width")):
                raise ValueError("browser screenshot requires only port, path, width and height")
            body = capture_preview(payload["port"], payload["path"], payload["width"], payload["height"], self.server.config.preview_ports)
            self._bytes(200, "image/png", body)
        except (json.JSONDecodeError, OSError, RuntimeError, ValueError, subprocess.TimeoutExpired) as error:
            self._json(400, {"error": str(error)})

    def log_message(self, _format: str, *args: object) -> None:
        """Suppress request logs because command content may include private workspace data."""

    def _authenticated(self) -> bool:
        """Compare every presented bearer with the server-derived secret file; refuse everything until the turn loop has written it.

        The server presents one credential per key still in its keyring, comma-separated and newest
        first, so a key rotation during this lease cannot lock it out of the Pod it granted.
        """
        try:
            expected = self.server.config.credential_path.read_text(encoding="utf-8").strip()
        except OSError:
            return False
        supplied = self.headers.get("Authorization", "").removeprefix("Bearer ")
        # Compare every value so the response time does not reveal which position matched.
        matched = [hmac.compare_digest(candidate.strip(), expected) for candidate in supplied.split(",")]
        return bool(expected) and any(matched)

    def _bytes(self, status: int, content_type: str, body: bytes) -> None:
        """Write one bounded byte response with defensive browser headers."""
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, status: int, value: dict[str, Any]) -> None:
        """Serialize one review result without caching it in an intermediary."""
        body = json.dumps(value, separators=(",", ":")).encode("utf-8")
        self._bytes(status, "application/json", body)


class ReviewSurfaceServer(ThreadingHTTPServer):
    """Carry immutable review policy into every request handler."""

    def __init__(self, config: ReviewSurfaceConfig):
        """Bind the gateway to the configured loopback address and port."""
        self.config = config
        super().__init__((config.host, config.port), _ReviewHandler)


def start_review_surface() -> ReviewSurfaceServer:
    """Start the lease-local review gateway in a daemon thread and return its server."""
    import threading

    start_browser()
    server = ReviewSurfaceServer(_configuration())
    worker = threading.Thread(target=server.serve_forever, name="conversation-review", daemon=True)
    worker.start()
    return server
