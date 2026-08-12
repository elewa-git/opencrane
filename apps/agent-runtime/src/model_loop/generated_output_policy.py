"""Apply provider-neutral policy to model-created files.

This module owns the file-count and byte limits shared by every provider path, byte-based media
admission, safe display names, and whole-batch ordering. It consumes only neutral dictionaries and
bytes. It must never understand provider coordinates, credentials, response annotations, or
transport.
"""

from __future__ import annotations

import hashlib
import io
import re
import unicodedata
import zipfile
from typing import Literal, TypedDict


MAX_GENERATED_OUTPUT_FILES = 10
MAX_GENERATED_OUTPUT_BYTES = 200 * 1024 * 1024
_MAX_DISPLAY_STEM_CHARACTERS = 72


class NeutralGeneratedOutput(TypedDict):
    """The provider-neutral output shape consumed by the core model loop."""

    type: Literal["output_asset"]
    content: bytes
    displayName: str
    mediaType: str
    outputOrdinal: int


class GeneratedOutputError(RuntimeError):
    """A safe visible generated-output failure that contains no provider data or secrets."""


def validate_generated_output_batch(events: list[dict[str, object]]) -> None:
    """Reject an oversized model-created file batch before the caller publishes any member."""
    outputs = [event for event in events if event.get("type") == "output_asset"]
    if len(outputs) > MAX_GENERATED_OUTPUT_FILES:
        raise ValueError("generated output batch has too many files")
    contents = [event.get("content") for event in outputs]
    if any(not isinstance(content, bytes) for content in contents):
        raise ValueError("generated output batch contains invalid bytes")
    total_bytes = sum(len(content) for content in contents if isinstance(content, bytes))
    if total_bytes > MAX_GENERATED_OUTPUT_BYTES:
        raise ValueError("generated output batch is too large")


def order_generated_outputs(events: list[dict[str, object]]) -> list[dict[str, object]]:
    """Place all validated files after streamed text in their collision-free provider order."""
    ordinary = [event for event in events if event.get("type") != "output_asset"]
    outputs = [event for event in events if event.get("type") == "output_asset"]
    if any(not isinstance(event.get("outputOrdinal"), int) for event in outputs):
        raise ValueError("generated output ordinal is invalid")
    return [*ordinary, *sorted(outputs, key=lambda event: int(event["outputOrdinal"]))]


def classify_generated_output_media(content: bytes) -> tuple[str, str]:
    """Classify an approved generated file from its bytes, never claimed metadata."""
    if not isinstance(content, bytes) or not content:
        raise GeneratedOutputError("generated file content is unsupported")
    if content.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png", "png"
    if content.startswith(b"%PDF-"):
        return "application/pdf", "pdf"
    if content.startswith(b"ID3") or _has_mpeg_audio_frame_header(content):
        return "audio/mpeg", "mp3"
    if content.startswith((b"PK\x03\x04", b"PK\x05\x06", b"PK\x07\x08")):
        return _classify_zip_media(content)
    raise GeneratedOutputError("generated file content is unsupported")


def safe_generated_output_name(
    suggested_name: str,
    content: bytes,
    ordinal: int,
    extension: str | None = None,
) -> str:
    """Create a bounded path-free name with a byte-derived collision suffix and extension."""
    if not isinstance(ordinal, int) or ordinal < 0:
        raise GeneratedOutputError("generated file ordinal is invalid")
    if extension is None:
        _, extension = classify_generated_output_media(content)
    normalized = unicodedata.normalize("NFKC", suggested_name if isinstance(suggested_name, str) else "")
    leaf = normalized.replace("\\", "/").rsplit("/", 1)[-1]
    stem = leaf.rsplit(".", 1)[0] if "." in leaf else leaf
    stem = re.sub(r"[^A-Za-z0-9 _.-]+", "-", stem)
    stem = re.sub(r"[ ._-]+", "-", stem).strip("-")[:_MAX_DISPLAY_STEM_CHARACTERS]
    if not stem:
        stem = f"generated-{ordinal + 1}"
    digest = hashlib.sha256(content).hexdigest()[:12]
    return f"{stem}-{ordinal + 1}-{digest}.{extension}"


def _has_mpeg_audio_frame_header(content: bytes) -> bool:
    """Recognize an MPEG audio frame header while rejecting reserved layer and rate fields."""
    if len(content) < 4 or content[0] != 0xFF or content[1] & 0xE0 != 0xE0:
        return False
    version = (content[1] >> 3) & 0x03
    layer = (content[1] >> 1) & 0x03
    bitrate = (content[2] >> 4) & 0x0F
    sample_rate = (content[2] >> 2) & 0x03
    return version != 0x01 and layer != 0x00 and bitrate not in (0x00, 0x0F) and sample_rate != 0x03


def _classify_zip_media(content: bytes) -> tuple[str, str]:
    """Distinguish Office Open XML from a generic ZIP by archive members."""
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            names = frozenset(archive.namelist())
            if "[Content_Types].xml" in names and "word/document.xml" in names:
                return "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx"
            if "[Content_Types].xml" in names and "xl/workbook.xml" in names:
                return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"
            return "application/zip", "zip"
    except (OSError, zipfile.BadZipFile, zipfile.LargeZipFile):
        raise GeneratedOutputError("generated file content is unsupported") from None
