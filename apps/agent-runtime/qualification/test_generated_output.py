"""Qualify the exact pinned Pydantic generated-file path inside the runtime image."""

import base64
import hashlib
import unittest

from openai.types.responses.response_output_item import ImageGenerationCall
from pydantic_ai.messages import PartStartEvent
from pydantic_ai.models.openai import OpenAIResponsesModel, _map_image_generation_tool_call
from pydantic_ai.native_tools import CodeExecutionTool, ImageGenerationTool

from src.attempts.execution import execute_start_attempt
from src.model_loop.driver import build_zero_retry_agent
from src.model_loop.openai_generated_outputs import OpenAIGeneratedOutputCollector
from src.transport.output import publish_output_asset


_CONTENT = b"\x89PNG\r\n\x1a\nexact pinned generated png"


class PinnedGeneratedOutputQualificationTests(unittest.TestCase):
    """Prove the exact framework event traverses real runtime projection and output transport."""

    def test_exact_file_part_reaches_reserve_and_put(self) -> None:
        """A pinned final FilePart is message-bound and published with no provider coordinates."""
        agent = build_zero_retry_agent(
            "silo-default",
            "http://litellm.invalid/v1",
            "attempt-key",
            "generate one image",
            generated_output_capabilities=("image_png", "code_execution_files"),
        )
        self.assertIsInstance(agent.model, OpenAIResponsesModel)
        image_tools = [tool for tool in agent._cap_native_tools if isinstance(tool, ImageGenerationTool)]
        self.assertEqual(len(image_tools), 1)
        image_tool = image_tools[0]
        self.assertEqual(image_tool.output_format, "png")
        self.assertEqual(image_tool.partial_images, 0)
        self.assertEqual(len([tool for tool in agent._cap_native_tools if isinstance(tool, CodeExecutionTool)]), 1)
        self.assertTrue(agent.model_settings["openai_include_code_execution_outputs"])
        self.assertTrue(agent.model_settings["openai_include_raw_annotations"])

        provider_item = ImageGenerationCall(
            id="provider-file-id-must-not-leak",
            result=base64.b64encode(_CONTENT).decode(),
            status="completed",
            type="image_generation_call",
        )
        _, _, file_part = _map_image_generation_tool_call(provider_item, "openai")
        self.assertIsNotNone(file_part)
        event = PartStartEvent(index=0, part=file_part)
        neutral = OpenAIGeneratedOutputCollector().observe(event, 0)
        self.assertIsNotNone(neutral)
        reserve_bodies: list[dict[str, object]] = []
        put_bodies: list[bytes] = []

        def _reserve(_url: str, _token: str, body: dict[str, object], _timeout: float):
            reserve_bodies.append(body)
            return 201, {"outcome": "issued", "ticketId": "ticket-1"}

        def _put(_url: str, _token: str, content: bytes, _timeout: float):
            put_bodies.append(content)
            return 202, {"outcome": "accepted"}

        def _publish(coordinates: dict[str, object], message_id: str, output: dict[str, object]) -> None:
            publish_output_asset(
                "https://control.invalid/internal/runtime",
                "runtime-token",
                coordinates,
                message_id,
                output,
                send_json=_reserve,
                send_bytes=_put,
            )

        command = {
            "kind": "start_attempt",
            "commandId": "command-pinned",
            "fence": 1,
            "assignment": {"runId": "run-pinned", "attempt": 1},
            "payload": {
                "snapshot": {"inputGeneration": 1},
                "compiledInput": {
                    "runId": "run-pinned",
                    "attempt": 1,
                    "promptCompilerVersion": "v1",
                    "instructions": "generate one image",
                    "messages": [],
                    "tools": [],
                    "model": {"modelAlias": "silo-default", "generatedOutputCapabilities": ["image_png"]},
                    "budget": {},
                    "digest": "sha256:pinned",
                },
            },
        }
        execute_start_attempt(
            command,
            "runtime-pinned",
            lambda _candidate: None,
            event_source=lambda _compiled, _cancel, _steering: iter([neutral]),
            publish_output=_publish,
        )

        self.assertEqual(put_bodies, [_CONTENT])
        self.assertEqual(len(reserve_bodies), 1)
        self.assertEqual(reserve_bodies[0]["messageId"], "assistant:command-pinned")
        self.assertEqual(reserve_bodies[0]["contentAddress"], "sha256:" + hashlib.sha256(_CONTENT).hexdigest())
        self.assertNotIn("provider-file-id", str(reserve_bodies[0]))


if __name__ == "__main__":
    unittest.main()
