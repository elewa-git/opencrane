"""Run Chromium's DevTools plane on loopback for the authenticated review gateway."""

from __future__ import annotations

import os
import subprocess
import tempfile
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Final

_CDP_ENDPOINT: Final = "http://127.0.0.1:9222"
_MAX_CDP_BYTES: Final = 1024 * 1024


def start_browser() -> subprocess.Popen[bytes]:
    """Start pinned image Chromium with CDP bound only to the Pod loopback interface."""
    executable = os.environ.get("OPENCRANE_CHROMIUM_PATH", "/usr/bin/chromium-browser")
    workspace = Path(os.environ.get("OPENCRANE_WORKSPACE_PATH", "/workspace")).resolve()
    profile = workspace / ".opencrane-chromium"
    profile.mkdir(mode=0o700, exist_ok=True)
    argv = [
        executable,
        "--headless=new",
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-default-apps",
        "--disable-sync",
        "--metrics-recording-only",
        "--no-first-run",
        "--remote-debugging-address=127.0.0.1",
        "--remote-debugging-port=9222",
        f"--user-data-dir={profile}",
        "about:blank",
    ]
    return subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)


def browser_metadata(kind: str) -> tuple[str, bytes]:
    """Read one fixed CDP discovery document without exposing its loopback endpoint."""
    if kind not in ("version", "list"):
        raise ValueError("browser metadata kind is unavailable")
    request = urllib.request.Request(f"{_CDP_ENDPOINT}/json/{kind}", method="GET")
    with urllib.request.urlopen(request, timeout=5) as response:
        body = response.read(_MAX_CDP_BYTES + 1)
        content_type = response.headers.get_content_type()
    if len(body) > _MAX_CDP_BYTES:
        raise ValueError("browser metadata exceeds the review limit")
    return content_type, body


def open_browser_page(port: int, path: str, allowed_ports: frozenset[int]) -> bytes:
    """Create a CDP page only for one release-allowlisted localhost preview URL."""
    if port not in allowed_ports:
        raise ValueError("browser preview port is not release-allowlisted")
    preview_url = f"http://127.0.0.1:{port}/{path.lstrip('/')}"
    query = urllib.parse.urlencode({"url": preview_url})
    request = urllib.request.Request(f"{_CDP_ENDPOINT}/json/new?{query}", data=b"", method="PUT")
    with urllib.request.urlopen(request, timeout=5) as response:
        body = response.read(_MAX_CDP_BYTES + 1)
    if len(body) > _MAX_CDP_BYTES:
        raise ValueError("browser target response exceeds the review limit")
    return body


def capture_preview(port: int, path: str, width: int, height: int, allowed_ports: frozenset[int]) -> bytes:
    """Render one allowlisted localhost preview to a bounded PNG without exposing raw CDP."""
    if port not in allowed_ports:
        raise ValueError("browser preview port is not release-allowlisted")
    if width < 320 or width > 1920 or height < 240 or height > 1080:
        raise ValueError("browser viewport is outside the review limit")
    executable = os.environ.get("OPENCRANE_CHROMIUM_PATH", "/usr/bin/chromium-browser")
    preview_url = f"http://127.0.0.1:{port}/{path.lstrip('/')}"
    with tempfile.TemporaryDirectory(prefix="opencrane-browser-") as directory:
        screenshot = Path(directory) / "preview.png"
        argv = [executable, "--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--disable-background-networking", "--no-first-run", f"--screenshot={screenshot}", f"--window-size={width},{height}", preview_url]
        result = subprocess.run(argv, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=15, check=False)
        if result.returncode != 0 or not screenshot.is_file():
            raise RuntimeError("browser could not render the localhost preview")
        body = screenshot.read_bytes()
    if len(body) > _MAX_CDP_BYTES:
        raise ValueError("browser screenshot exceeds the review limit")
    return body
