"""Verify the strict agent-runtime continuation wire boundary."""

import json
import unittest
from pathlib import Path

from src.attempts.continuation_codec import (
    MAX_IDENTIFIER_CHARACTERS,
    MAX_PENDING_CORRELATIONS,
    MAX_SERIALIZED_CONTINUATION_BYTES,
    canonical_bytes,
    decode_continuation,
    digest_continuation,
    encode_continuation,
    serialize_model_messages,
)


def _unsigned(**changes: object) -> dict[str, object]:
    """Build one valid unsigned continuation fixture."""
    value: dict[str, object] = {
        "version": "opencrane.agent-runtime-continuation/v1",
        "revision": 1,
        "runId": "run-1",
        "attempt": 1,
        "inputGeneration": 0,
        "appliedCommandSequence": 1,
        "compiledInput": {"runId": "run-1", "attempt": 1},
        "modelMessages": [],
        "pendingToolCalls": [{"toolInvocationId": "tool-1", "frameworkCallId": "call-1"}],
        "pendingElicitations": [],
    }
    value.update(changes)
    return value


class ContinuationCodecTests(unittest.TestCase):
    """Keep Python encoding aligned with the protocol-v2 TypeScript parser."""

    def test_matches_cross_language_fixtures(self) -> None:
        """Accept and reject the same neutral documents as the server parser."""
        fixture_path = Path(__file__).resolve().parents[3] / "docs/design/runtime-continuation-conformance-fixtures.json"
        fixtures = json.loads(fixture_path.read_text(encoding="utf-8"))
        self.assertEqual(
            fixtures["limits"],
            {
                "identifierCharacters": MAX_IDENTIFIER_CHARACTERS,
                "pendingCorrelationsPerClass": MAX_PENDING_CORRELATIONS,
                "serializedContinuationBytes": MAX_SERIALIZED_CONTINUATION_BYTES,
            },
        )
        for fixture in fixtures["cases"]:
            with self.subTest(name=fixture["name"]):
                if fixture["accepted"]:
                    self.assertEqual(decode_continuation(fixture["document"]), fixture["document"])
                else:
                    with self.assertRaises(RuntimeError):
                        decode_continuation(fixture["document"])

    def test_encode_and_decode_bind_every_field_to_the_canonical_digest(self) -> None:
        """Key order does not change the digest and a changed field fails closed."""
        unsigned = _unsigned(modelMessages=[{"content": "continue"}])
        reordered = {key: unsigned[key] for key in reversed(tuple(unsigned))}

        first = encode_continuation(unsigned)
        second = encode_continuation(reordered)
        self.assertEqual(first["digest"], second["digest"])
        self.assertEqual(first, decode_continuation(first))

        first["revision"] = 2
        with self.assertRaisesRegex(RuntimeError, "digest"):
            decode_continuation(first)

    def test_identifiers_accept_256_characters_and_reject_257(self) -> None:
        """The Python codec uses the same identifier limit as the server parser."""
        accepted = encode_continuation(_unsigned(runId="r" * MAX_IDENTIFIER_CHARACTERS))
        self.assertEqual(len(accepted["runId"]), MAX_IDENTIFIER_CHARACTERS)

        with self.assertRaisesRegex(RuntimeError, "content"):
            encode_continuation(_unsigned(runId="r" * (MAX_IDENTIFIER_CHARACTERS + 1)))

    def test_pending_lists_accept_128_unique_items_and_reject_more(self) -> None:
        """Both correlation classes stop at the shared 128-item limit."""
        tools = [
            {"toolInvocationId": f"tool-{index}", "frameworkCallId": f"tool-call-{index}"}
            for index in range(MAX_PENDING_CORRELATIONS)
        ]
        elicitations = [
            {"requestKey": f"question-{index}", "frameworkCallId": f"question-call-{index}"}
            for index in range(MAX_PENDING_CORRELATIONS)
        ]
        encode_continuation(_unsigned(pendingToolCalls=tools, pendingElicitations=elicitations))

        with self.assertRaisesRegex(RuntimeError, "content"):
            encode_continuation(_unsigned(pendingToolCalls=[*tools, {"toolInvocationId": "overflow", "frameworkCallId": "overflow"}]))

    def test_duplicate_framework_correlations_fail_closed(self) -> None:
        """Two pending results cannot target the same framework call."""
        duplicate = [
            {"requestKey": "question-1", "frameworkCallId": "call-1"},
            {"requestKey": "question-2", "frameworkCallId": "call-1"},
        ]

        with self.assertRaisesRegex(RuntimeError, "content"):
            encode_continuation(_unsigned(pendingElicitations=duplicate))

    def test_serialized_document_accepts_48kib_and_rejects_one_more_byte(self) -> None:
        """The exact plaintext boundary matches the shared server constant."""
        base = encode_continuation(_unsigned(modelMessages=[{"content": ""}]))
        content_length = MAX_SERIALIZED_CONTINUATION_BYTES - len(canonical_bytes(base))
        accepted = encode_continuation(_unsigned(modelMessages=[{"content": "x" * content_length}]))
        self.assertEqual(len(canonical_bytes(accepted)), MAX_SERIALIZED_CONTINUATION_BYTES)

        with self.assertRaisesRegex(RuntimeError, "oversized"):
            encode_continuation(_unsigned(modelMessages=[{"content": "x" * (content_length + 1)}]))

    def test_model_message_adapter_copies_plain_json(self) -> None:
        """Saving messages cannot retain a mutable reference to the model loop."""
        messages: list[object] = [{"role": "user", "content": ["hello"]}]
        serialized = serialize_model_messages(messages)
        messages[0]["content"].append("changed")

        self.assertEqual(serialized, [{"role": "user", "content": ["hello"]}])
        self.assertEqual(digest_continuation(_unsigned()), encode_continuation(_unsigned())["digest"])


if __name__ == "__main__":
    unittest.main()
