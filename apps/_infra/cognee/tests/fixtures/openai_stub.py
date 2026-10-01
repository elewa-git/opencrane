#!/usr/bin/env python3
"""Serve deterministic OpenAI-compatible chat and embeddings without recording content."""

import hashlib
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any


def _resolve_reference(reference: str, root_schema: dict[str, Any]) -> dict[str, Any]:
    if not reference.startswith("#/"):
        raise AssertionError(f"The deterministic stub cannot resolve schema reference {reference}")
    value: Any = root_schema
    for segment in reference[2:].split("/"):
        if not isinstance(value, dict) or segment not in value:
            raise AssertionError(f"The deterministic stub cannot resolve schema reference {reference}")
        value = value[segment]
    if not isinstance(value, dict):
        raise AssertionError(f"Schema reference does not resolve to an object: {reference}")
    return value


def _minimal_value(
    schema: dict[str, Any], name: str = "value", root_schema: dict[str, Any] | None = None
) -> Any:
    root = schema if root_schema is None else root_schema
    if "$ref" in schema:
        return _minimal_value(_resolve_reference(str(schema["$ref"]), root), name, root)
    if "const" in schema:
        return schema["const"]
    if "enum" in schema and schema["enum"]:
        return schema["enum"][0]
    if "allOf" in schema and schema["allOf"]:
        values = [_minimal_value(part, name, root) for part in schema["allOf"]]
        if all(isinstance(value, dict) for value in values):
            merged = {}
            for value in values:
                merged.update(value)
            return merged
        return values[0]
    for alternative in schema.get("anyOf", schema.get("oneOf", [])):
        if alternative.get("type") != "null":
            return _minimal_value(alternative, name, root)
    schema_type = schema.get("type")
    if schema_type == "object" or "properties" in schema:
        properties = schema.get("properties", {})
        required = schema.get("required", [])
        return {
            key: _minimal_value(properties.get(key, {}), key, root)
            for key in required
        }
    if schema_type == "array":
        return []
    if schema_type == "integer":
        return max(0, int(schema.get("minimum", 0)))
    if schema_type == "number":
        return max(0.0, float(schema.get("minimum", 0.0)))
    if schema_type == "boolean":
        return False
    return name


def _embedding(text: str, dimensions: int) -> list[float]:
    vector = [0.0] * dimensions
    lowered = text.lower()
    if "isolation query" in lowered or "foreign-decoy" in lowered:
        vector[0] = 1.0
        return vector
    if "authorized-memory" in lowered:
        vector[0] = 0.8
        if dimensions > 1:
            vector[1] = 0.6
        return vector
    digest = hashlib.sha256(text.encode("utf-8")).digest()
    for index in range(dimensions):
        vector[index] = (digest[index % len(digest)] / 255.0) - 0.5
    return vector


class _Handler(BaseHTTPRequestHandler):
    """Handle only the OpenAI endpoints used by the provider contract."""

    server_version = "OpenCraneMemoryContractStub/1"

    def log_message(self, _format: str, *_args: object) -> None:
        return

    def _write_metadata(self, model: str, item_count: int, status: int) -> None:
        entry = {
            "method": self.command,
            "path": self.path,
            "model": model,
            "itemCount": item_count,
            "status": status,
        }
        log_path = Path(os.environ["STUB_METADATA_LOG"])
        with log_path.open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(entry, sort_keys=True) + "\n")

    def _reply(self, payload: dict[str, Any], status: int = 200) -> None:
        encoded = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def do_GET(self) -> None:
        if self.path == "/health":
            self._reply({"status": "ok"})
            return
        self._reply({"error": "not_found"}, 404)

    def do_POST(self) -> None:
        length = int(self.headers.get("content-length", "0"))
        try:
            body = json.loads(self.rfile.read(length))
        except (json.JSONDecodeError, UnicodeDecodeError):
            self._reply({"error": "invalid_json"}, 400)
            return
        model = str(body.get("model", ""))
        if self.path.endswith("/embeddings"):
            values = body.get("input", [])
            inputs = values if isinstance(values, list) else [values]
            dimensions = int(body.get("dimensions", os.environ.get("STUB_DIMENSIONS", "1536")))
            data = [
                {"object": "embedding", "index": index, "embedding": _embedding(str(value), dimensions)}
                for index, value in enumerate(inputs)
            ]
            self._write_metadata(model, len(inputs), 200)
            self._reply(
                {
                    "object": "list",
                    "model": model,
                    "data": data,
                    "usage": {"prompt_tokens": len(inputs), "total_tokens": len(inputs)},
                }
            )
            return
        if self.path.endswith("/chat/completions"):
            response_format = body.get("response_format", {})
            schema = response_format.get("json_schema", {}).get("schema", {})
            content = json.dumps(_minimal_value(schema)) if schema else "{}"
            messages = body.get("messages", [])
            self._write_metadata(model, len(messages) if isinstance(messages, list) else 0, 200)
            message: dict[str, Any] = {"role": "assistant", "content": content}
            tools = body.get("tools", [])
            if isinstance(tools, list) and tools:
                function = tools[0].get("function", {})
                parameters = function.get("parameters", {})
                arguments = json.dumps(_minimal_value(parameters))
                message = {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "call_memory_contract",
                            "type": "function",
                            "function": {"name": function.get("name", "respond"), "arguments": arguments},
                        }
                    ],
                }
            self._reply(
                {
                    "id": "chatcmpl-memory-contract",
                    "object": "chat.completion",
                    "created": 0,
                    "model": model,
                    "choices": [
                        {
                            "index": 0,
                            "message": message,
                            "finish_reason": "tool_calls" if tools else "stop",
                        }
                    ],
                    "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
                }
            )
            return
        self._reply({"error": "not_found"}, 404)


def main() -> None:
    os.umask(0o077)
    port = int(os.environ.get("STUB_PORT", "8090"))
    server = ThreadingHTTPServer(("0.0.0.0", port), _Handler)
    server.serve_forever()


if __name__ == "__main__":
    main()
