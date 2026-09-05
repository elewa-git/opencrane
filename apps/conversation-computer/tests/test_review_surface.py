"""Prove the conversation computer review surface stays bounded and lease-local."""

from __future__ import annotations

import json
import os
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

from src.browser_surface import capture_preview, open_browser_page, start_browser
from src.review_surface import ReviewSurfaceConfig, ReviewSurfaceServer, _git_diff, _run_command, _workspace_path


class _PreviewHandler(BaseHTTPRequestHandler):
    """Serve fixed preview bytes for the loopback proxy test."""

    def do_GET(self) -> None:
        """Return one small HTML page."""
        body = b"<h1>preview</h1>"
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, _format: str, *args: object) -> None:
        """Keep the test output free of HTTP access logs."""


class ReviewSurfaceTest(unittest.TestCase):
    """Exercise authentication, path confinement, command admission and preview allowlisting."""

    def setUp(self) -> None:
        """Create an isolated workspace and authenticated review listener."""
        self.temporary = tempfile.TemporaryDirectory()
        self.workspace = Path(self.temporary.name)
        self.token_path = self.workspace / "token"
        self.token_path.write_text("lease-secret", encoding="utf-8")
        self.config = ReviewSurfaceConfig(self.workspace, self.token_path, frozenset({"python3", "git"}), frozenset(), port=0)
        self.server = ReviewSurfaceServer(self.config)
        self.worker = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.worker.start()
        self.base_url = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self) -> None:
        """Stop the listener and remove the isolated workspace."""
        self.server.shutdown()
        self.server.server_close()
        self.temporary.cleanup()

    def _request(self, path: str, token: str | None = "lease-secret", payload: dict[str, object] | None = None) -> urllib.request.Request:
        """Build one review request with an optional bearer credential."""
        body = None if payload is None else json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(f"{self.base_url}{path}", data=body, method="GET" if body is None else "POST")
        if token is not None:
            request.add_header("Authorization", f"Bearer {token}")
        if body is not None:
            request.add_header("Content-Type", "application/json")
        return request

    def test_refuses_missing_or_wrong_credential(self) -> None:
        """Require the current lease-local bearer value before every operation."""
        for token in (None, "wrong"):
            with self.assertRaises(urllib.error.HTTPError) as context:
                urllib.request.urlopen(self._request("/v1/files?path=note.txt", token), timeout=2)
            self.assertEqual(context.exception.code, 401)

    def test_current_lease_id_is_the_server_proxy_credential(self) -> None:
        """Prefer the generation-fenced lease credential shared by canonical server history."""
        previous = os.environ.get("OPENCRANE_COMPUTER_LEASE_ID")
        os.environ["OPENCRANE_COMPUTER_LEASE_ID"] = "current-lease-secret"
        try:
            with self.assertRaises(urllib.error.HTTPError) as context:
                urllib.request.urlopen(self._request("/v1/files?path=note.txt", "lease-secret"), timeout=2)
            self.assertEqual(context.exception.code, 401)
        finally:
            if previous is None:
                os.environ.pop("OPENCRANE_COMPUTER_LEASE_ID", None)
            else:
                os.environ["OPENCRANE_COMPUTER_LEASE_ID"] = previous

    def test_reads_selected_file_but_rejects_path_escape(self) -> None:
        """Keep selected file reads inside the resolved workspace root."""
        (self.workspace / "note.txt").write_text("safe", encoding="utf-8")
        with urllib.request.urlopen(self._request("/v1/files?path=note.txt"), timeout=2) as response:
            self.assertEqual(response.read(), b"safe")
        with self.assertRaises(urllib.error.HTTPError) as context:
            urllib.request.urlopen(self._request("/v1/files?path=../secret"), timeout=2)
        self.assertEqual(context.exception.code, 400)

    def test_runs_argv_without_shell_expansion_and_rejects_other_binary(self) -> None:
        """Treat metacharacters as ordinary argv values and enforce the release command list."""
        result = _run_command(self.config, {"argv": ["python3", "-c", "import sys;print(sys.argv[1])", "$(id)"], "cwd": "."})
        self.assertEqual(result["exitCode"], 0)
        self.assertEqual(result["output"], "$(id)\n")
        with self.assertRaisesRegex(ValueError, "not release-allowlisted"):
            _run_command(self.config, {"argv": ["sh", "-c", "id"], "cwd": "."})

    def test_rejects_symlink_that_resolves_outside_workspace(self) -> None:
        """Apply confinement after symlink resolution instead of trusting path text."""
        outside = self.workspace.parent / "outside-review-secret"
        outside.write_text("secret", encoding="utf-8")
        try:
            (self.workspace / "escape").symlink_to(outside)
            with self.assertRaisesRegex(ValueError, "leaves the workspace"):
                _workspace_path(self.config, "escape")
        finally:
            outside.unlink(missing_ok=True)

    def test_proxies_only_an_explicit_loopback_preview_port(self) -> None:
        """Proxy a configured localhost server while refusing every other destination port."""
        preview = ThreadingHTTPServer(("127.0.0.1", 0), _PreviewHandler)
        preview_worker = threading.Thread(target=preview.serve_forever, daemon=True)
        preview_worker.start()
        try:
            self.server.config = ReviewSurfaceConfig(self.workspace, self.token_path, frozenset({"git"}), frozenset({preview.server_port}), port=self.server.server_port)
            with urllib.request.urlopen(self._request(f"/v1/previews/{preview.server_port}/index.html"), timeout=2) as response:
                self.assertEqual(response.read(), b"<h1>preview</h1>")
                self.assertEqual(response.headers["Cache-Control"], "no-store")
            with self.assertRaises(urllib.error.HTTPError) as context:
                urllib.request.urlopen(self._request("/v1/previews/65534/index.html"), timeout=2)
            self.assertEqual(context.exception.code, 400)
        finally:
            preview.shutdown()
            preview.server_close()

    def test_starts_chromium_with_loopback_only_cdp(self) -> None:
        """Keep raw DevTools unreachable from the Sandbox Service and public proxy."""
        with patch.dict(os.environ, {"OPENCRANE_WORKSPACE_PATH": str(self.workspace)}):
            with patch("src.browser_surface.subprocess.Popen") as launch:
                start_browser()
        argv = launch.call_args.args[0]
        self.assertIn("--remote-debugging-address=127.0.0.1", argv)
        self.assertIn("--remote-debugging-port=9222", argv)
        self.assertNotIn("--remote-debugging-address=0.0.0.0", argv)

    def test_browser_page_accepts_only_allowlisted_local_preview(self) -> None:
        """Prevent browser target creation from turning CDP into an arbitrary URL fetcher."""
        response = unittest.mock.MagicMock()
        response.__enter__.return_value.read.return_value = b'{"id":"target-1"}'
        with patch("src.browser_surface.urllib.request.urlopen", return_value=response) as open_url:
            body = open_browser_page(4173, "index.html", frozenset({4173}))
        self.assertEqual(body, b'{"id":"target-1"}')
        request = open_url.call_args.args[0]
        self.assertTrue(request.full_url.startswith("http://127.0.0.1:9222/json/new?"))
        self.assertIn("127.0.0.1%3A4173", request.full_url)
        with self.assertRaisesRegex(ValueError, "not release-allowlisted"):
            open_browser_page(443, "", frozenset({4173}))

    def test_image_pins_chromium_without_exposing_cdp(self) -> None:
        """Keep the qualified browser version fixed while raw DevTools stays inside the container."""
        dockerfile = (Path(__file__).parents[1] / "deploy" / "Dockerfile").read_text(encoding="utf-8")
        self.assertIn("chromium=142.0.7444.59-r0", dockerfile)
        self.assertNotIn("EXPOSE 9222", dockerfile)

    def test_browser_screenshot_is_local_bounded_and_pinned_to_viewport(self) -> None:
        """Render only an allowlisted localhost URL with the requested bounded viewport."""
        def _Render(argv: list[str], **_kwargs: object):
            screenshot_argument = next(value for value in argv if value.startswith("--screenshot="))
            Path(screenshot_argument.removeprefix("--screenshot=")).write_bytes(b"png")
            return unittest.mock.MagicMock(returncode=0)

        with patch("src.browser_surface.subprocess.run", side_effect=_Render) as render:
            body = capture_preview(4173, "page", 1280, 720, frozenset({4173}))
        self.assertEqual(body, b"png")
        argv = render.call_args.args[0]
        self.assertIn("--window-size=1280,720", argv)
        self.assertEqual(argv[-1], "http://127.0.0.1:4173/page")
        with self.assertRaisesRegex(ValueError, "viewport"):
            capture_preview(4173, "", 4096, 720, frozenset({4173}))

    def test_git_diff_uses_no_external_diff_and_selected_path(self) -> None:
        """Return only the selected path through Git's built-in diff implementation."""
        subprocess_config = ReviewSurfaceConfig(self.workspace, self.token_path, frozenset({"git"}), frozenset())
        _run_command(subprocess_config, {"argv": ["git", "init"], "cwd": "."})
        _run_command(subprocess_config, {"argv": ["git", "config", "user.email", "test@opencrane.invalid"], "cwd": "."})
        _run_command(subprocess_config, {"argv": ["git", "config", "user.name", "OpenCrane Test"], "cwd": "."})
        (self.workspace / "selected.txt").write_text("before\n", encoding="utf-8")
        (self.workspace / "other.txt").write_text("before\n", encoding="utf-8")
        _run_command(subprocess_config, {"argv": ["git", "add", "selected.txt", "other.txt"], "cwd": "."})
        _run_command(subprocess_config, {"argv": ["git", "commit", "-m", "fixture"], "cwd": "."})
        (self.workspace / "selected.txt").write_text("after\n", encoding="utf-8")
        (self.workspace / "other.txt").write_text("after\n", encoding="utf-8")
        result = _git_diff(subprocess_config, "selected.txt")
        self.assertIn("selected.txt", result["output"])
        self.assertNotIn("other.txt", result["output"])


if __name__ == "__main__":
    unittest.main()
