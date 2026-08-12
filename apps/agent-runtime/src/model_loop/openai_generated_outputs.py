"""Adapt OpenAI generated-output capabilities and events into neutral files.

Only this adapter understands OpenAI response annotations and Pydantic native-tool configuration.
It queues provider-private coordinates behind the container transport and gives the core model loop
only neutral outputs. It must never perform control-plane publication or own general file policy.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from .generated_output_policy import (
    MAX_GENERATED_OUTPUT_BYTES,
    MAX_GENERATED_OUTPUT_FILES,
    GeneratedOutputError,
    NeutralGeneratedOutput,
    classify_generated_output_media,
    safe_generated_output_name,
)
from .openai_container_files import OpenAIContainerFileReference, retrieve_openai_generated_outputs


_ADMITTED_CAPABILITIES = frozenset({"code_execution_files", "image_png"})


@dataclass(frozen=True)
class OpenAIGeneratedOutputConfiguration:
    """Exact Pydantic capabilities and model settings for admitted generated outputs."""

    capabilities: tuple[object, ...]
    model_settings: Mapping[str, object]


@dataclass(frozen=True)
class _QueuedContainerFile:
    """One provider-private reference bound to its neutral output ordinal."""

    reference: OpenAIContainerFileReference
    output_ordinal: int


class OpenAIGeneratedOutputCollector:
    """Own provider event knowledge and one cumulative generated-file budget.

    The core loop observes framework events and receives at most a neutral in-memory output. OpenAI
    coordinates remain queued here until :meth:`finish` retrieves them through an attempt-scoped
    client. The collector is single-use because retrying a failed provider read is forbidden.
    """

    def __init__(self) -> None:
        """Create an empty collector for one model-loop attempt."""
        self._queued: list[_QueuedContainerFile] = []
        self._seen_references: set[tuple[str, str]] = set()
        self._direct_file_count = 0
        self._direct_byte_count = 0
        self._reserved_file_count = 0
        self._next_ordinal = 0
        self._finished = False

    def observe(self, event: object, ordinal: int) -> NeutralGeneratedOutput | None:
        """Observe one exact framework event without exposing provider coordinates."""
        if self._finished:
            raise GeneratedOutputError("generated output collector is already finished")
        if not isinstance(ordinal, int) or ordinal < 0:
            raise GeneratedOutputError("generated file ordinal is invalid")
        self._next_ordinal = max(self._next_ordinal, ordinal)

        direct_output = self._observe_completed_file_part(event)
        references = openai_container_file_references(event)
        for reference in references:
            identity = (reference.container_id, reference.file_id)
            if identity in self._seen_references:
                continue
            self._reserve_file()
            self._seen_references.add(identity)
            self._queued.append(_QueuedContainerFile(reference, self._take_ordinal()))
        return direct_output

    async def finish(
        self,
        *,
        base_url: str,
        attempt_key: str,
        http_client: object | None = None,
    ) -> list[NeutralGeneratedOutput]:
        """Retrieve all queued provider files once and return only neutral outputs."""
        if self._finished:
            raise GeneratedOutputError("generated output collector is already finished")
        self._finished = True
        if not self._queued:
            return []
        return await retrieve_openai_generated_outputs(
            [queued.reference for queued in self._queued],
            base_url=base_url,
            attempt_key=attempt_key,
            starting_file_count=self._direct_file_count,
            starting_byte_count=self._direct_byte_count,
            output_ordinals=[queued.output_ordinal for queued in self._queued],
            http_client=http_client,
        )

    def _observe_completed_file_part(self, event: object) -> NeutralGeneratedOutput | None:
        """Map a final Pydantic FilePart by local bytes and the shared collector budget."""
        if getattr(event, "event_kind", None) != "part_start":
            return None
        part = getattr(event, "part", None)
        if getattr(part, "part_kind", None) != "file":
            return None
        binary_content = getattr(part, "content", None)
        content = getattr(binary_content, "data", None)
        claimed_media_type = getattr(binary_content, "media_type", None)
        if not isinstance(content, bytes):
            raise GeneratedOutputError("generated file content is unsupported")
        media_type, extension = classify_generated_output_media(content)
        if claimed_media_type != media_type:
            raise GeneratedOutputError("generated file media type does not match its content")
        self._reserve_file()
        self._direct_file_count += 1
        self._direct_byte_count += len(content)
        if self._direct_byte_count > MAX_GENERATED_OUTPUT_BYTES:
            raise GeneratedOutputError("generated file batch exceeds its byte limit")
        output_ordinal = self._take_ordinal()
        return {
            "type": "output_asset",
            "content": content,
            "displayName": safe_generated_output_name("generated", content, output_ordinal, extension),
            "mediaType": media_type,
            "outputOrdinal": output_ordinal,
        }

    def _reserve_file(self) -> None:
        """Reserve one slot before any file can be observed or retrieved."""
        self._reserved_file_count += 1
        if self._reserved_file_count > MAX_GENERATED_OUTPUT_FILES:
            raise GeneratedOutputError("generated file batch exceeds its file limit")

    def _take_ordinal(self) -> int:
        """Return one collision-free ordinal in observed provider order."""
        ordinal = self._next_ordinal
        self._next_ordinal += 1
        return ordinal


def openai_generated_output_configuration(
    admitted_capabilities: Sequence[str],
) -> OpenAIGeneratedOutputConfiguration:
    """Build only the native tools admitted by the immutable model route.

    Imports stay lazy so runtime protocol tests do not require provider packages. Unknown or
    repeated capability names fail closed instead of silently widening model authority.
    """
    capability_names = tuple(admitted_capabilities)
    if len(set(capability_names)) != len(capability_names):
        raise GeneratedOutputError("generated-output capabilities are invalid")
    if set(capability_names) - _ADMITTED_CAPABILITIES:
        raise GeneratedOutputError("generated-output capabilities are invalid")

    from pydantic_ai.capabilities import NativeTool
    from pydantic_ai.models.openai import OpenAIResponsesModelSettings
    from pydantic_ai.native_tools import CodeExecutionTool, ImageGenerationTool

    capabilities: list[object] = []
    if "image_png" in capability_names:
        capabilities.append(NativeTool(ImageGenerationTool(output_format="png", partial_images=0)))
    if "code_execution_files" in capability_names:
        capabilities.append(NativeTool(CodeExecutionTool()))
        model_settings = OpenAIResponsesModelSettings(
            openai_include_code_execution_outputs=True,
            openai_include_raw_annotations=True,
        )
    else:
        model_settings = OpenAIResponsesModelSettings()
    return OpenAIGeneratedOutputConfiguration(tuple(capabilities), model_settings)


def openai_container_file_references(event: object) -> tuple[OpenAIContainerFileReference, ...]:
    """Extract exact container citations from the final annotation-bearing text delta.

    Pydantic AI 2.13 adds raw annotations only on the empty ``TextDone`` delta. Earlier text
    fragments and generic file annotations are deliberately ignored because they are not proof of a
    completed OpenAI container file.
    """
    if getattr(event, "event_kind", None) != "part_delta":
        return ()
    delta = getattr(event, "delta", None)
    if getattr(delta, "part_delta_kind", None) != "text" or getattr(delta, "content_delta", None) != "":
        return ()
    provider_details = getattr(delta, "provider_details", None)
    if not isinstance(provider_details, Mapping):
        return ()
    annotations = provider_details.get("annotations")
    if not isinstance(annotations, list):
        return ()

    references: list[OpenAIContainerFileReference] = []
    for annotation in annotations:
        if not isinstance(annotation, Mapping) or annotation.get("type") != "container_file_citation":
            continue
        container_id = annotation.get("container_id")
        file_id = annotation.get("file_id")
        filename = annotation.get("filename")
        if not all(isinstance(value, str) and value for value in (container_id, file_id, filename)):
            raise GeneratedOutputError("generated file reference is invalid")
        references.append(OpenAIContainerFileReference(container_id, file_id, filename))
    return tuple(references)
