"""Authoring-only verified bundle intake primitives.

The deployment entrypoint does not invoke these functions until the image contains the complete,
pinned offline validator suite. Keeping this intake inside the authoring app prevents the shared
bootstrap client from becoming a tool-runner dependency.
"""

import hashlib
import os
import re
import secrets
import tarfile
from pathlib import Path
from typing import Callable, Protocol
from urllib.error import HTTPError, URLError
from urllib.request import Request

import bootstrap


_ARCHIVE_BYTES = 16 * 1024 * 1024
_EXTRACTED_BYTES = 32 * 1024 * 1024
_MAX_ARCHIVE_ENTRIES = 1_000
_MAX_FILE_BYTES = 8 * 1024 * 1024
_READ_CHUNK_BYTES = 64 * 1024
_CONTENT_ADDRESS_HEADER = "x-opencrane-content-address"


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


def _safe_member_path(value: str) -> str:
    """Reject every archive path outside the future extracted root or with ambiguous representation."""
    if not value or "\x00" in value or value.startswith("/") or value.endswith("/") or any(part in {"", ".", ".."} for part in value.split("/")):
        raise RuntimeError("authoring bundle contains an unsafe path")
    return value


def _remove_tree(path: Path) -> None:
    """Remove only the extractor-created regular-file tree after a failed validation step."""
    for child in path.iterdir():
        if child.is_dir():
            _remove_tree(child)
        else:
            child.unlink()
    path.rmdir()
