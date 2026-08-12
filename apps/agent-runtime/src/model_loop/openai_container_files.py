"""Retrieve OpenAI container files through one attempt-scoped zero-retry transport.

This module consumes provider-private container coordinates and produces neutral, locally
classified file outputs. It owns the official client path, authenticated streaming, and safe
transport failures. It must never decide which provider capabilities are admitted or publish bytes
to the OpenCrane control plane.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from ..observability import trace
from .generated_output_policy import (
    MAX_GENERATED_OUTPUT_BYTES,
    MAX_GENERATED_OUTPUT_FILES,
    GeneratedOutputError,
    NeutralGeneratedOutput,
    classify_generated_output_media,
    safe_generated_output_name,
)


_STREAM_CHUNK_BYTES = 64 * 1024


@dataclass(frozen=True)
class OpenAIContainerFileReference:
    """Attempt-private coordinates for one generated OpenAI container file."""

    container_id: str
    file_id: str
    filename: str


async def retrieve_openai_generated_outputs(
    references: Sequence[OpenAIContainerFileReference],
    *,
    base_url: str,
    attempt_key: str,
    starting_ordinal: int = 0,
    starting_file_count: int = 0,
    starting_byte_count: int = 0,
    output_ordinals: Sequence[int] | None = None,
    http_client: object | None = None,
) -> list[NeutralGeneratedOutput]:
    """Retrieve and classify one complete attempt-scoped batch with zero retries.

    All provider reads finish before a neutral output list is returned, so count, cumulative size,
    retrieval, and file-type failures cannot result in partial publication.
    """
    unique_references = _unique_references(references)
    if not isinstance(starting_file_count, int) or not 0 <= starting_file_count <= MAX_GENERATED_OUTPUT_FILES:
        raise GeneratedOutputError("generated file count is invalid")
    if not isinstance(starting_byte_count, int) or not 0 <= starting_byte_count <= MAX_GENERATED_OUTPUT_BYTES:
        raise GeneratedOutputError("generated file byte count is invalid")
    if starting_file_count + len(unique_references) > MAX_GENERATED_OUTPUT_FILES:
        raise GeneratedOutputError("generated file batch exceeds its file limit")
    if not isinstance(starting_ordinal, int) or starting_ordinal < 0:
        raise GeneratedOutputError("generated file ordinal is invalid")
    resolved_ordinals = _resolve_ordinals(unique_references, starting_ordinal, output_ordinals)
    if not base_url or not attempt_key:
        raise GeneratedOutputError("generated file retrieval configuration is invalid")

    from openai import AsyncOpenAI

    client_arguments: dict[str, object] = {
        "api_key": attempt_key,
        "base_url": base_url,
        "max_retries": 0,
    }
    if http_client is not None:
        client_arguments["http_client"] = http_client
    try:
        client = AsyncOpenAI(**client_arguments)
    except Exception:
        raise GeneratedOutputError("generated file retrieval configuration is invalid") from None
    outputs: list[NeutralGeneratedOutput] = []
    total_bytes = starting_byte_count
    try:
        for offset, reference in enumerate(unique_references):
            file_bytes, total_bytes = await _retrieve_file(
                client,
                reference,
                resolved_ordinals[offset],
                total_bytes,
            )
            media_type, extension = classify_generated_output_media(file_bytes)
            outputs.append(
                {
                    "type": "output_asset",
                    "content": file_bytes,
                    "displayName": safe_generated_output_name(
                        reference.filename,
                        file_bytes,
                        resolved_ordinals[offset],
                        extension,
                    ),
                    "mediaType": media_type,
                    "outputOrdinal": resolved_ordinals[offset],
                },
            )
    finally:
        try:
            await client.close()
        except Exception:
            # Closing an attempt-owned client must not replace the already-safe operation outcome.
            pass
    return outputs


def _resolve_ordinals(
    references: Sequence[OpenAIContainerFileReference],
    starting_ordinal: int,
    output_ordinals: Sequence[int] | None,
) -> tuple[int, ...]:
    """Resolve one unique non-negative ordinal for each validated provider reference."""
    if output_ordinals is None:
        return tuple(starting_ordinal + offset for offset in range(len(references)))
    resolved = tuple(output_ordinals)
    if len(resolved) != len(references) or any(not isinstance(value, int) or value < 0 for value in resolved):
        raise GeneratedOutputError("generated file ordinals are invalid")
    if len(set(resolved)) != len(resolved):
        raise GeneratedOutputError("generated file ordinals are invalid")
    return resolved


async def _retrieve_file(
    client: object,
    reference: OpenAIContainerFileReference,
    ordinal: int,
    starting_byte_count: int,
) -> tuple[bytes, int]:
    """Stream one provider file once and return its bytes with the updated shared byte count."""
    content = bytearray()
    total_bytes = starting_byte_count
    try:
        with trace("agent_runtime.output.fetch", outputOrdinal=ordinal) as span:
            # OpenAI Python 2.54 requires the streaming wrapper; its direct binary helper buffers.
            async with client.containers.files.content.with_streaming_response.retrieve(
                reference.file_id,
                container_id=reference.container_id,
            ) as response:
                async for chunk in response.iter_bytes(_STREAM_CHUNK_BYTES):
                    if not isinstance(chunk, bytes):
                        raise GeneratedOutputError("generated file retrieval failed")
                    total_bytes += len(chunk)
                    if total_bytes > MAX_GENERATED_OUTPUT_BYTES:
                        raise GeneratedOutputError("generated file batch exceeds its byte limit")
                    content.extend(chunk)
            if span is not None:
                span.set_attribute("byteLength", len(content))
    except GeneratedOutputError:
        raise
    except Exception:
        raise GeneratedOutputError("generated file retrieval failed") from None
    return bytes(content), total_bytes


def _unique_references(
    references: Sequence[OpenAIContainerFileReference],
) -> tuple[OpenAIContainerFileReference, ...]:
    """Validate and de-duplicate provider coordinates without exposing them on failure."""
    unique: list[OpenAIContainerFileReference] = []
    seen: set[tuple[str, str]] = set()
    for reference in references:
        if not isinstance(reference, OpenAIContainerFileReference):
            raise GeneratedOutputError("generated file reference is invalid")
        if not reference.container_id or not reference.file_id or not reference.filename:
            raise GeneratedOutputError("generated file reference is invalid")
        identity = (reference.container_id, reference.file_id)
        if identity in seen:
            continue
        seen.add(identity)
        unique.append(reference)
    return tuple(unique)
