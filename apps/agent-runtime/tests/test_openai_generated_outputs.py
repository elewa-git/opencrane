"""Offline proofs for the provider-private OpenAI generated-output adapter."""

import contextlib
import io
import types
import unittest
import unittest.mock
import zipfile

from src.model_loop import openai_generated_outputs as _adapter
from src.model_loop.openai_generated_outputs import (
    OpenAIContainerFileReference as _Reference,
    OpenAIGeneratedOutputCollector as _Collector,
    OpenAIGeneratedOutputError as _OutputError,
    classify_generated_output_media as _classify_media,
    openai_container_file_references as _references,
    openai_generated_output_configuration as _configuration,
    retrieve_openai_generated_outputs as _retrieve_outputs,
    safe_generated_output_name as _safe_name,
)


_ATTEMPT_KEY = "sk-attempt-private"
_PNG = b"\x89PNG\r\n\x1a\n" + b"generated-image"
_PDF = b"%PDF-1.7\n% generated"
_MP3 = b"ID3\x04\x00\x00\x00\x00\x00\x00audio"


def _zip_bytes(*names: str) -> bytes:
    """Build a minimal valid ZIP containing the named archive members."""
    target = io.BytesIO()
    with zipfile.ZipFile(target, "w") as archive:
        for name in names:
            archive.writestr(name, b"content")
    return target.getvalue()


def _final_annotation_event(*annotations: dict[str, object]) -> object:
    """Build the exact final Pydantic text-delta surface carrying raw annotations."""
    return types.SimpleNamespace(
        event_kind="part_delta",
        delta=types.SimpleNamespace(
            part_delta_kind="text",
            content_delta="",
            provider_details={"annotations": list(annotations)},
        ),
    )


class OpenAIAnnotationBoundaryTests(unittest.TestCase):
    """Accept only final exact container annotations and keep coordinates private."""

    def test_only_final_container_file_citations_are_consumed(self) -> None:
        """Partial text and generic file paths cannot become output reads."""
        citation = {
            "type": "container_file_citation",
            "container_id": "container-private",
            "file_id": "file-private",
            "filename": "report.pdf",
        }
        partial = types.SimpleNamespace(
            event_kind="part_delta",
            delta=types.SimpleNamespace(
                part_delta_kind="text",
                content_delta="still streaming",
                provider_details={"annotations": [citation]},
            ),
        )
        final = _final_annotation_event(
            {"type": "file_path", "file_id": "wrong-file", "filename": "wrong.pdf"},
            citation,
        )

        self.assertEqual(_references(partial), ())
        self.assertEqual(
            _references(final),
            (_Reference("container-private", "file-private", "report.pdf"),),
        )

    def test_malformed_container_citation_fails_with_sanitized_message(self) -> None:
        """A matching but incomplete citation fails closed without echoing its provider body."""
        event = _final_annotation_event(
            {
                "type": "container_file_citation",
                "container_id": "container-secret",
                "file_id": "",
                "filename": "secret.txt",
            },
        )

        with self.assertRaisesRegex(_OutputError, "generated file reference is invalid") as failure:
            _references(event)

        self.assertNotIn("container-secret", str(failure.exception))
        self.assertNotIn("secret.txt", str(failure.exception))


class GeneratedOutputClassificationTests(unittest.TestCase):
    """Classify approved files by content and synthesize bounded safe names."""

    def test_magic_bytes_classify_every_approved_media_type(self) -> None:
        """Claims and extensions are ignored in favor of six approved byte formats."""
        fixtures = {
            _PNG: ("image/png", "png"),
            _PDF: ("application/pdf", "pdf"),
            _MP3: ("audio/mpeg", "mp3"),
            _zip_bytes("plain.txt"): ("application/zip", "zip"),
            _zip_bytes("[Content_Types].xml", "word/document.xml"): (
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                "docx",
            ),
            _zip_bytes("[Content_Types].xml", "xl/workbook.xml"): (
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "xlsx",
            ),
        }

        for content, expected in fixtures.items():
            with self.subTest(expected=expected):
                self.assertEqual(_classify_media(content), expected)

    def test_invalid_signature_and_broken_zip_are_rejected(self) -> None:
        """A filename, claimed MIME, or ZIP prefix cannot bypass local byte verification."""
        for content in (b"plain text named report.pdf", b"PK\x03\x04not-a-zip"):
            with self.subTest(content=content[:8]):
                with self.assertRaisesRegex(_OutputError, "generated file content is unsupported"):
                    _classify_media(content)

    def test_safe_name_removes_paths_bounds_stem_and_corrects_extension(self) -> None:
        """The displayed name is path-free, bounded, content-bound, and uses the magic extension."""
        suggested = "../unsafe\\nested/" + ("résumé<> " * 30) + ".exe"

        name = _safe_name(suggested, _PDF, 2)

        self.assertTrue(name.endswith(".pdf"))
        self.assertNotIn("/", name)
        self.assertNotIn("\\", name)
        self.assertNotIn("<", name)
        self.assertLessEqual(len(name), 72 + 1 + len(str(3)) + 1 + 12 + 4)
        self.assertEqual(name, _safe_name(suggested, _PDF, 2))
        self.assertNotEqual(name, _safe_name(suggested, _PDF + b"changed", 2))


class OpenAIConfigurationTests(unittest.TestCase):
    """Bind generated-output admission to exact pinned Pydantic types and settings."""

    def test_exact_native_tools_and_responses_settings_are_built(self) -> None:
        """The two admitted capability names map to only their exact native provider tools."""
        try:
            from pydantic_ai.capabilities import NativeTool
            from pydantic_ai.native_tools import CodeExecutionTool, ImageGenerationTool
        except ImportError:
            self.skipTest("pinned Pydantic AI runtime dependency is not installed")

        configuration = _configuration(("image_png", "code_execution_files"))

        self.assertEqual(len(configuration.capabilities), 2)
        self.assertTrue(all(isinstance(value, NativeTool) for value in configuration.capabilities))
        image_tool = configuration.capabilities[0].tool
        code_tool = configuration.capabilities[1].tool
        self.assertIsInstance(image_tool, ImageGenerationTool)
        self.assertEqual(image_tool.output_format, "png")
        self.assertEqual(image_tool.partial_images, 0)
        self.assertIsInstance(code_tool, CodeExecutionTool)
        self.assertEqual(
            configuration.model_settings,
            {
                "openai_include_code_execution_outputs": True,
                "openai_include_raw_annotations": True,
            },
        )

    def test_non_admitted_or_duplicate_capabilities_fail_closed(self) -> None:
        """An immutable route cannot smuggle an unknown or repeated provider capability."""
        for capabilities in (("file_search",), ("image_png", "image_png")):
            with self.subTest(capabilities=capabilities):
                with self.assertRaisesRegex(_OutputError, "generated-output capabilities are invalid"):
                    _configuration(capabilities)


class OpenAIContainerRetrievalTests(unittest.IsolatedAsyncioTestCase):
    """Prove zero-retry authenticated streaming over the exact official container path."""

    async def test_streams_exact_path_and_returns_only_neutral_fields(self) -> None:
        """One exact citation becomes one magic-classified output without provider coordinates."""
        try:
            import httpx
            import openai  # noqa: F401
        except ImportError:
            self.skipTest("pinned OpenAI runtime dependency is not installed")
        requests: list[object] = []
        spans: list[tuple[str, dict[str, object], dict[str, object]]] = []

        @contextlib.contextmanager
        def _trace(operation: str, **attributes: object):
            recorded_attributes: dict[str, object] = {}
            spans.append((operation, attributes, recorded_attributes))
            yield types.SimpleNamespace(set_attribute=recorded_attributes.__setitem__)

        class _Chunks(httpx.AsyncByteStream):
            async def __aiter__(self):
                yield _PNG[:5]
                yield _PNG[5:]

        def _handler(request: object):
            requests.append(request)
            return httpx.Response(200, stream=_Chunks())

        http_client = httpx.AsyncClient(transport=httpx.MockTransport(_handler))
        with unittest.mock.patch.object(_adapter, "trace", _trace):
            outputs = await _retrieve_outputs(
                [_Reference("container-1", "file-1", "../result.exe")],
                base_url="https://provider.example/v1",
                attempt_key=_ATTEMPT_KEY,
                starting_ordinal=4,
                http_client=http_client,
            )

        self.assertEqual(len(requests), 1)
        request = requests[0]
        self.assertEqual(str(request.url), "https://provider.example/v1/containers/container-1/files/file-1/content")
        self.assertEqual(request.headers["authorization"], f"Bearer {_ATTEMPT_KEY}")
        self.assertEqual(
            set(outputs[0]),
            {"type", "content", "displayName", "mediaType", "outputOrdinal"},
        )
        self.assertEqual(outputs[0]["type"], "output_asset")
        self.assertEqual(outputs[0]["content"], _PNG)
        self.assertEqual(outputs[0]["mediaType"], "image/png")
        self.assertEqual(outputs[0]["outputOrdinal"], 4)
        self.assertTrue(outputs[0]["displayName"].endswith(".png"))
        self.assertNotIn("container-1", repr(outputs))
        self.assertNotIn("file-1", repr(outputs))
        self.assertNotIn(_ATTEMPT_KEY, repr(outputs))
        self.assertEqual(
            spans,
            [("agent_runtime.output.fetch", {"outputOrdinal": 4}, {"byteLength": len(_PNG)})],
        )
        self.assertNotIn("container-1", repr(spans))
        self.assertNotIn("file-1", repr(spans))
        self.assertNotIn(_ATTEMPT_KEY, repr(spans))

    async def test_retrieval_failure_is_not_retried_and_redacts_provider_details(self) -> None:
        """The attempt gets one safe failure even when the provider returns secrets and coordinates."""
        try:
            import httpx
            import openai  # noqa: F401
        except ImportError:
            self.skipTest("pinned OpenAI runtime dependency is not installed")
        requests: list[object] = []

        def _handler(request: object):
            requests.append(request)
            return httpx.Response(503, json={"error": "provider-body-secret", "api_key": _ATTEMPT_KEY})

        http_client = httpx.AsyncClient(transport=httpx.MockTransport(_handler))
        with self.assertRaisesRegex(_OutputError, "generated file retrieval failed") as failure:
            await _retrieve_outputs(
                [_Reference("container-secret", "file-secret", "secret.pdf")],
                base_url="https://provider.example/v1",
                attempt_key=_ATTEMPT_KEY,
                http_client=http_client,
            )

        self.assertEqual(len(requests), 1)
        visible = str(failure.exception)
        for secret in (_ATTEMPT_KEY, "provider-body-secret", "container-secret", "file-secret"):
            self.assertNotIn(secret, visible)

    async def test_file_count_limit_fails_before_any_provider_request(self) -> None:
        """An eleventh unique citation cannot cause a partial provider read or neutral output."""
        references = [_Reference(f"container-{index}", f"file-{index}", "result.pdf") for index in range(11)]

        with self.assertRaisesRegex(_OutputError, "generated file batch exceeds its file limit"):
            await _retrieve_outputs(
                references,
                base_url="https://provider.invalid/v1",
                attempt_key=_ATTEMPT_KEY,
            )

    async def test_cumulative_byte_limit_aborts_without_returning_partial_outputs(self) -> None:
        """Streaming stops when the shared total crosses the cap, before any list can be published."""
        try:
            import httpx
            import openai  # noqa: F401
        except ImportError:
            self.skipTest("pinned OpenAI runtime dependency is not installed")
        requests: list[object] = []

        class _Chunks(httpx.AsyncByteStream):
            async def __aiter__(self):
                yield _PNG

        def _handler(request: object):
            requests.append(request)
            return httpx.Response(200, stream=_Chunks())

        http_client = httpx.AsyncClient(transport=httpx.MockTransport(_handler))
        references = [
            _Reference("container-1", "file-1", "first.png"),
            _Reference("container-2", "file-2", "second.png"),
        ]
        with unittest.mock.patch.object(_adapter, "MAX_GENERATED_OUTPUT_BYTES", len(_PNG) + 1):
            with self.assertRaisesRegex(_OutputError, "generated file batch exceeds its byte limit"):
                await _retrieve_outputs(
                    references,
                    base_url="https://provider.example/v1",
                    attempt_key=_ATTEMPT_KEY,
                    http_client=http_client,
                )

        self.assertEqual(len(requests), 2)


class OpenAIGeneratedOutputCollectorTests(unittest.IsolatedAsyncioTestCase):
    """Keep all provider coordinates and one shared budget behind the collector seam."""

    async def test_direct_file_part_is_magic_checked_and_uses_a_collision_safe_ordinal(self) -> None:
        """The core sees only a neutral output whose media type comes from bytes, not provider IDs."""
        collector = _Collector()
        event = types.SimpleNamespace(
            event_kind="part_start",
            part=types.SimpleNamespace(
                part_kind="file",
                id="provider-file-secret",
                provider_details={"container_id": "container-secret"},
                content=types.SimpleNamespace(data=_PNG, media_type="image/png"),
            ),
        )

        output = collector.observe(event, 3)

        self.assertIsNotNone(output)
        self.assertEqual(output["type"], "output_asset")
        self.assertEqual(output["mediaType"], "image/png")
        self.assertEqual(output["outputOrdinal"], 3)
        self.assertIn("-4-", output["displayName"])
        self.assertNotIn("provider-file-secret", repr(output))
        self.assertNotIn("container-secret", repr(output))
        self.assertEqual(
            await collector.finish(base_url="https://unused.invalid/v1", attempt_key=_ATTEMPT_KEY),
            [],
        )

    async def test_direct_file_part_rejects_claimed_media_mismatch(self) -> None:
        """An approved claimed MIME cannot override the locally classified file signature."""
        collector = _Collector()
        event = types.SimpleNamespace(
            event_kind="part_start",
            part=types.SimpleNamespace(
                part_kind="file",
                content=types.SimpleNamespace(data=_PNG, media_type="application/pdf"),
            ),
        )

        with self.assertRaisesRegex(_OutputError, "media type does not match"):
            collector.observe(event, 0)

    async def test_remote_file_uses_budget_and_ordinal_reserved_behind_observe(self) -> None:
        """Final annotations queue privately and finish returns only neutral downloaded output."""
        try:
            import httpx
            import openai  # noqa: F401
        except ImportError:
            self.skipTest("pinned OpenAI runtime dependency is not installed")

        class _Chunks(httpx.AsyncByteStream):
            async def __aiter__(self):
                yield _PDF

        http_client = httpx.AsyncClient(
            transport=httpx.MockTransport(lambda _request: httpx.Response(200, stream=_Chunks())),
        )
        collector = _Collector()
        observed = collector.observe(
            _final_annotation_event(
                {
                    "type": "container_file_citation",
                    "container_id": "container-private",
                    "file_id": "file-private",
                    "filename": "report.tmp",
                },
            ),
            5,
        )

        outputs = await collector.finish(
            base_url="https://provider.example/v1",
            attempt_key=_ATTEMPT_KEY,
            http_client=http_client,
        )

        self.assertIsNone(observed)
        self.assertEqual(outputs[0]["outputOrdinal"], 5)
        self.assertEqual(outputs[0]["mediaType"], "application/pdf")
        self.assertTrue(outputs[0]["displayName"].endswith(".pdf"))
        self.assertNotIn("container-private", repr(outputs))
        self.assertNotIn("file-private", repr(outputs))

    async def test_direct_bytes_reduce_the_remaining_remote_batch_budget(self) -> None:
        """A remote stream cannot ignore bytes already admitted from an in-memory FilePart."""
        try:
            import httpx
            import openai  # noqa: F401
        except ImportError:
            self.skipTest("pinned OpenAI runtime dependency is not installed")

        class _Chunks(httpx.AsyncByteStream):
            async def __aiter__(self):
                yield _PDF

        http_client = httpx.AsyncClient(
            transport=httpx.MockTransport(lambda _request: httpx.Response(200, stream=_Chunks())),
        )
        collector = _Collector()
        direct_event = types.SimpleNamespace(
            event_kind="part_start",
            part=types.SimpleNamespace(
                part_kind="file",
                content=types.SimpleNamespace(data=_PNG, media_type="image/png"),
            ),
        )
        collector.observe(direct_event, 0)
        collector.observe(
            _final_annotation_event(
                {
                    "type": "container_file_citation",
                    "container_id": "container-private",
                    "file_id": "file-private",
                    "filename": "report.pdf",
                },
            ),
            1,
        )

        with unittest.mock.patch.object(_adapter, "MAX_GENERATED_OUTPUT_BYTES", len(_PNG) + len(_PDF) - 1):
            with self.assertRaisesRegex(_OutputError, "generated file batch exceeds its byte limit"):
                await collector.finish(
                    base_url="https://provider.example/v1",
                    attempt_key=_ATTEMPT_KEY,
                    http_client=http_client,
                )


if __name__ == "__main__":
    unittest.main()
