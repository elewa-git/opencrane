"""Authoring-only verified bundle intake primitives.

The deployment entrypoint does not invoke these functions until the image contains the complete,
pinned offline validator suite. Keeping this intake inside the authoring app prevents the shared
bootstrap client from becoming a tool-runner dependency.
"""

import hashlib
import json
import os
import re
import secrets
import signal
import subprocess
import sys
import tarfile
import tempfile
import tomllib
from pathlib import Path
from typing import Callable, Protocol, Sequence
from urllib.error import HTTPError, URLError
from urllib.request import Request

import bootstrap


_ARCHIVE_BYTES = 16 * 1024 * 1024
_EXTRACTED_BYTES = 32 * 1024 * 1024
_MAX_ARCHIVE_ENTRIES = 1_000
_MAX_FILE_BYTES = 8 * 1024 * 1024
_READ_CHUNK_BYTES = 64 * 1024
_CONTENT_ADDRESS_HEADER = "x-opencrane-content-address"
_VALIDATOR_TIMEOUT_SECONDS = 60
_VALIDATOR_DATABASE = Path("/opt/opencrane/clamav-db")
_VALIDATOR_COMMANDS = (
    ("/opt/opencrane/bin/ruff", "format", "--check", "."),
    ("/opt/opencrane/bin/mypy", "."),
    ("/opt/opencrane/bin/pytest", "-q", "tests"),
)
_MALWARE_COMMAND = ("/opt/opencrane/bin/clamscan", "--database=/opt/opencrane/clamav-db", "--infected", "--no-summary", "--recursive", ".")
_SECRET_PATTERN = re.compile(r"(?i)(?:api[_-]?key|secret|token|password)\s*[=:]\s*['\"][^'\"]{8,}['\"]")
_MAX_COMPLETION_BODY_BYTES = 4_096
_WORK_DIRECTORY_PREFIX = "opencrane-skill-authoring-"
_VALIDATION_FAILURE_CODE = "offline_validation_failed"
_TERMINAL_DELIVERY_ATTEMPTS = 3


class _InputResponse(Protocol):
    """Minimal bounded HTTP response used only by the authoring input downloader."""

    status: int
    headers: object

    def read(self, amount: int = -1) -> bytes:
        """Read at most the requested response bytes."""


def _input_url(base_url: str, workload_id: str) -> str:
    """Derive the sole authoring input URL after validating the deployment-owned internal base URL."""
    if not bootstrap._workload_id(workload_id):
        raise RuntimeError("authoring workload identifier is invalid")
    bootstrap._acknowledgement_url(base_url)
    return f"{base_url}/skill-authoring-workloads/{workload_id}/input"


def _completion_url(base_url: str) -> str:
    """Derive the sole terminal authoring completion URL after validating the deployment-owned internal base URL."""
    bootstrap._acknowledgement_url(base_url)
    return f"{base_url}/skill-authoring-workloads:complete"


def download_bundle(base_url: str, workload_id: str, token_path: str, destination: Path, open_request: Callable[[Request, float], _InputResponse] = bootstrap._open) -> Path:
    """Download one server-brokered bundle, verify its fixed digest and length, then atomically retain it."""
    token = bootstrap._read_single_line(token_path, "capability token")
    request = Request(_input_url(base_url, workload_id), headers={"Authorization": f"Bearer {token}", "Accept": "application/gzip"}, method="GET")
    temporary = destination.with_name(f".{destination.name}.{secrets.token_hex(16)}.part")
    try:
        response = open_request(request, 10.0)
        length = _content_length(response)
        address = _content_address(response)
        if response.status != 200 or length is None or address is None:
            raise RuntimeError("authoring input was rejected")
        temporary.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        digest = hashlib.sha256()
        written = 0
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "wb") as target:
            while True:
                chunk = response.read(_READ_CHUNK_BYTES)
                if not chunk:
                    break
                written += len(chunk)
                if written > length or written > _ARCHIVE_BYTES:
                    raise RuntimeError("authoring input exceeded its bound")
                digest.update(chunk)
                target.write(chunk)
        if written != length or f"sha256:{digest.hexdigest()}" != address:
            raise RuntimeError("authoring input integrity check failed")
        os.replace(temporary, destination)
        return destination
    except HTTPError as error:
        try:
            raise RuntimeError(f"authoring input was denied ({error.code})") from error
        finally:
            error.close()
    except (OSError, URLError) as error:
        raise RuntimeError("authoring input is unavailable") from error
    finally:
        temporary.unlink(missing_ok=True)


def extract_bundle(archive: Path, destination: Path) -> Path:
    """Safely extract a bounded regular-file tar archive and require the authoring bundle contract."""
    temporary = destination.with_name(f".{destination.name}.{secrets.token_hex(16)}.part")
    seen: set[str] = set()
    total = 0
    try:
        temporary.mkdir(mode=0o700, parents=True)
        with tarfile.open(archive, "r|gz") as bundle:
            count = 0
            for member in bundle:
                count += 1
                path = _safe_member_path(member.name)
                if count > _MAX_ARCHIVE_ENTRIES or path in seen or not (member.isdir() or member.isreg()) or member.size < 0 or member.size > _MAX_FILE_BYTES:
                    raise RuntimeError("authoring bundle contains an unsafe entry")
                seen.add(path)
                target = temporary.joinpath(*path.split("/"))
                if member.isdir():
                    target.mkdir(mode=0o700, parents=True, exist_ok=False)
                    continue
                total += member.size
                if total > _EXTRACTED_BYTES:
                    raise RuntimeError("authoring bundle extraction exceeded its bound")
                target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                source = bundle.extractfile(member)
                if source is None:
                    raise RuntimeError("authoring bundle contains an unreadable entry")
                with source, target.open("xb") as output:
                    while chunk := source.read(_READ_CHUNK_BYTES):
                        output.write(chunk)
        if not (temporary / "SKILL.md").is_file() or not (temporary / "pyproject.toml").is_file() or not (temporary / "tests").is_dir():
            raise RuntimeError("authoring bundle is missing required files")
        os.replace(temporary, destination)
        return destination
    except (OSError, tarfile.TarError) as error:
        raise RuntimeError("authoring bundle extraction failed") from error
    finally:
        if temporary.exists():
            _remove_tree(temporary)


def _content_length(response: _InputResponse) -> int | None:
    """Parse the exact bounded decimal content length supplied by the server broker."""
    value = getattr(response.headers, "get", lambda _: None)("content-length")
    return int(value) if isinstance(value, str) and len(value) <= 8 and re.fullmatch(r"[1-9][0-9]*", value) and int(value) <= _ARCHIVE_BYTES else None


def _content_address(response: _InputResponse) -> str | None:
    """Accept only the canonical SHA-256 address from the server-owned immutable revision selection."""
    value = getattr(response.headers, "get", lambda _: None)(_CONTENT_ADDRESS_HEADER)
    return value if isinstance(value, str) and re.fullmatch(r"sha256:[a-f0-9]{64}", value) else None


def validate_bundle(destination: Path, execute: Callable[[Sequence[str], Path, int], int] | None = None, database: Path = _VALIDATOR_DATABASE) -> tuple[dict[str, object], dict[str, object]]:
    """Run only fixed offline checks over one extracted bundle and return completion-safe evidence."""
    if execute is None:
        execute = _run_command
    _assert_dependency_policy(destination / "pyproject.toml")
    _assert_no_plaintext_secrets(destination)
    _assert_validator_layout(database)
    test_checks = 0
    for command in _VALIDATOR_COMMANDS:
        if execute(command, destination, _VALIDATOR_TIMEOUT_SECONDS) != 0:
            return _report(False, "offline validation check failed", test_checks + 1), _report(False, "offline scan was not completed", 0)
        test_checks += 1
    if execute(_MALWARE_COMMAND, destination, _VALIDATOR_TIMEOUT_SECONDS) != 0:
        return _report(True, "format, type, and test checks passed", test_checks), _report(False, "offline malware scan found a problem", 3)
    return _report(True, "format, type, and test checks passed", test_checks), _report(True, "dependency policy, secret scan, and offline malware scan passed", 3)


def complete_workload(base_url: str, workload_id: str, token_path: str, command: dict[str, object], open_request: Callable[[Request, float], _InputResponse] = bootstrap._open) -> None:
    """Send one exact bounded terminal outcome using a freshly read projected token and reject every ambiguous response."""
    if not bootstrap._workload_id(workload_id) or not _completion_command(command, workload_id):
        raise RuntimeError("authoring completion command is invalid")
    token = bootstrap._read_single_line(token_path, "capability token")
    request = Request(_completion_url(base_url), data=json.dumps(command, separators=(",", ":")).encode("utf-8"), headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json", "Accept": "application/json"}, method="POST")
    try:
        response = open_request(request, 10.0)
        body = response.read(_MAX_COMPLETION_BODY_BYTES + 1)
        if len(body) > _MAX_COMPLETION_BODY_BYTES:
            raise RuntimeError("authoring completion response exceeded its bound")
        payload = json.loads(body.decode("utf-8"))
    except HTTPError as error:
        try:
            raise RuntimeError(f"authoring completion was denied ({error.code})") from error
        finally:
            error.close()
    except (OSError, URLError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RuntimeError("authoring completion is unavailable") from error
    if response.status != 200 or payload != {"completed": True}:
        raise RuntimeError("authoring completion was rejected")


def run_authoring_workload(base_url: str, workload_id: str, token_path: str, download: Callable[[str, str, str, Path], Path] = download_bundle, extract: Callable[[Path, Path], Path] = extract_bundle, validate: Callable[[Path], tuple[dict[str, object], dict[str, object]]] = validate_bundle, complete: Callable[[str, str, str, dict[str, object]], None] = complete_workload) -> int:
    """Perform one bootstrap-bound validation and send exactly one bounded terminal outcome.

    The server selected ``workload_id`` during bootstrap. This worker only obtains its immutable
    archive through that server-owned route, runs image-owned checks, and cleans its ephemeral
    workspace regardless of outcome. A technical failure is intentionally collapsed to one stable
    code because raw candidate output and local paths do not cross the worker boundary.
    """
    work_directory: Path | None = None
    try:
        try:
            work_directory = Path(tempfile.mkdtemp(prefix=_WORK_DIRECTORY_PREFIX, dir="/tmp"))
            archive = download(base_url, workload_id, token_path, work_directory / "bundle.tar.gz")
            extracted = extract(archive, work_directory / "bundle")
            test_report, scan_result = validate(extracted)
        except (OSError, RuntimeError):
            return _complete_failed_workload(base_url, workload_id, token_path, complete)
        if test_report.get("passed") is not True or scan_result.get("passed") is not True:
            return _complete_failed_workload(base_url, workload_id, token_path, complete)
        if _deliver_terminal(base_url, workload_id, token_path, {"workloadId": workload_id, "outcome": "succeeded", "testReport": test_report, "scanResult": scan_result}, complete):
            return 0
        _write_event("completion_uncertain")
        return 1
    finally:
        if work_directory is not None:
            _cleanup_work_directory(work_directory)


def _complete_failed_workload(base_url: str, workload_id: str, token_path: str, complete: Callable[[str, str, str, dict[str, object]], None]) -> int:
    """Submit the one technical failure without masking an authority outage as a successful Job."""
    if not _deliver_terminal(base_url, workload_id, token_path, {"workloadId": workload_id, "outcome": "failed", "failureCode": _VALIDATION_FAILURE_CODE}, complete):
        _write_event("failure_completion_unavailable")
    return 1


def _deliver_terminal(base_url: str, workload_id: str, token_path: str, command: dict[str, object], complete: Callable[[str, str, str, dict[str, object]], None]) -> bool:
    """Retry one exact terminal command a small fixed number of times without changing its outcome."""
    for _ in range(_TERMINAL_DELIVERY_ATTEMPTS):
        try:
            complete(base_url, workload_id, token_path, command)
            return True
        except (OSError, RuntimeError):
            pass
    return False


def _cleanup_work_directory(path: Path) -> None:
    """Best-effort erase the worker-owned temporary tree without changing its terminal result."""
    try:
        _remove_tree(path)
    except OSError:
        _write_event("workspace_cleanup_failed")


def _write_event(event: str) -> None:
    """Emit one non-sensitive structured lifecycle event for an operator-facing short-lived Job log."""
    print(json.dumps({"component": "skill-authoring-worker", "event": event}, sort_keys=True), file=sys.stderr, flush=True)


def _assert_dependency_policy(project: Path) -> None:
    """Reject every candidate dependency declaration until OpenCrane ships a pinned offline wheelhouse policy."""
    try:
        with project.open("rb") as source:
            data = tomllib.load(source)
    except (OSError, tomllib.TOMLDecodeError) as error:
        raise RuntimeError("authoring bundle dependency policy could not be read") from error
    project_table = data.get("project")
    if not isinstance(project_table, dict) or _contains_dependency_declaration(data):
        raise RuntimeError("authoring bundle declares unsupported dependencies")


def _assert_no_plaintext_secrets(destination: Path) -> None:
    """Reject straightforward credential assignments before untrusted tests are allowed to start."""
    for source in destination.rglob("*"):
        if source.is_file() and _SECRET_PATTERN.search(source.read_text(encoding="utf-8", errors="ignore")):
            raise RuntimeError("authoring bundle contains a plaintext secret")


def _assert_validator_layout(database: Path) -> None:
    """Require the image-owned validator tools and a non-empty read-only signature database before scanning."""
    if not all(Path(command[0]).is_file() and os.access(command[0], os.X_OK) for command in (*_VALIDATOR_COMMANDS, _MALWARE_COMMAND)) or not database.is_dir() or not any(path.is_file() and path.suffix in {".cvd", ".cld"} for path in database.iterdir()):
        raise RuntimeError("offline validator image is not provisioned")


def _run_command(command: Sequence[str], destination: Path, timeout: int) -> int:
    """Run one fixed image-owned command without a shell, candidate arguments, captured output, or unbounded duration."""
    try:
        process = subprocess.Popen(tuple(command), cwd=destination, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, shell=False, start_new_session=True)
        return process.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait()
        return 1
    except OSError:
        return 1


def _report(passed: bool, summary: str, checks_run: int) -> dict[str, object]:
    """Create the small, non-sensitive evidence shape accepted by the terminal completion route."""
    return {"passed": passed, "summary": summary, "checksRun": checks_run}


def _contains_dependency_declaration(value: object) -> bool:
    """Reject dependency metadata at every TOML nesting level, including Poetry-style tables and build-system requirements."""
    if isinstance(value, dict):
        return any(key in {"dependencies", "optional-dependencies", "requires", "dynamic"} or _contains_dependency_declaration(child) for key, child in value.items())
    if isinstance(value, list):
        return any(_contains_dependency_declaration(child) for child in value)
    return False


def _completion_command(command: dict[str, object], workload_id: str) -> bool:
    """Keep completion payloads within the server-owned two-outcome contract and never forward raw validator output."""
    if command.get("workloadId") != workload_id:
        return False
    if command.get("outcome") == "failed":
        failure_code = command.get("failureCode")
        return set(command) == {"workloadId", "outcome", "failureCode"} and isinstance(failure_code, str) and re.fullmatch(r"[a-z][a-z0-9_]{0,63}", failure_code) is not None
    if command.get("outcome") == "succeeded":
        return set(command) == {"workloadId", "outcome", "testReport", "scanResult"} and _completion_report(command.get("testReport")) and _completion_report(command.get("scanResult"))
    return False


def _completion_report(value: object) -> bool:
    """Validate the exact bounded report shape enforced by the completion router before any network call starts."""
    if not isinstance(value, dict) or set(value) != {"passed", "summary", "checksRun"}:
        return False
    return value.get("passed") is True and isinstance(value.get("summary"), str) and 0 < len(value["summary"]) <= 2_000 and not any(character in value["summary"] for character in "\x00\n\r") and type(value.get("checksRun")) is int and 0 <= value["checksRun"] <= 10_000


def _safe_member_path(value: str) -> str:
    """Reject every archive path outside the future extracted root or with ambiguous representation."""
    if not value or "\x00" in value or value.startswith("/") or value.endswith("/") or any(part in {"", ".", ".."} for part in value.split("/")):
        raise RuntimeError("authoring bundle contains an unsafe path")
    return value


def _remove_tree(path: Path) -> None:
    """Remove a worker-owned candidate tree after restoring owner access to candidate-created directories."""
    if path.is_symlink() or not path.is_dir():
        path.unlink(missing_ok=True)
        return
    os.chmod(path, 0o700)
    for root, directories, _ in os.walk(path, topdown=True, followlinks=False):
        root_path = Path(root)
        os.chmod(root_path, 0o700)
        for directory in tuple(directories):
            candidate = root_path / directory
            if candidate.is_symlink():
                candidate.unlink()
                directories.remove(directory)
            else:
                os.chmod(candidate, 0o700)
    for root, directories, files in os.walk(path, topdown=False, followlinks=False):
        root_path = Path(root)
        for file_name in files:
            (root_path / file_name).unlink(missing_ok=True)
        for directory in directories:
            (root_path / directory).rmdir()
    path.rmdir()


def main() -> int:
    """Bootstrap one released authoring Job, then execute its bounded validation lifecycle."""
    try:
        base_url = bootstrap._required_environment("OPENCRANE_SKILL_BOOTSTRAP_URL")
        token_path = bootstrap._required_environment("OPENCRANE_SKILL_TOKEN_PATH")
        reference_path = bootstrap._required_environment("OPENCRANE_SKILL_BOOTSTRAP_REFERENCE_PATH")
        workload_id = bootstrap.acknowledge(base_url, token_path, reference_path)
        return run_authoring_workload(base_url, workload_id, token_path)
    except RuntimeError as error:
        print(json.dumps({"component": "skill-authoring-worker", "event": "validation_unavailable", "reason": str(error)}, sort_keys=True), file=sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
