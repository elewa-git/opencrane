#!/usr/bin/env python3
"""Verify strict mode-specific parsing of Cognee CHUNKS search responses."""

import unittest

from provider_api import _parse_chunks_response


DATASET_ID = "dataset-one"
CHUNK = {"id": "chunk-one", "document_id": "document-one", "text": "content"}


class ProviderSearchResponseTest(unittest.TestCase):
    def test_acl_disabled_accepts_only_the_flat_chunk_array(self) -> None:
        self.assertEqual(_parse_chunks_response([CHUNK], DATASET_ID, False), [CHUNK])
        with self.assertRaisesRegex(AssertionError, "unexpectedly contains a dataset envelope"):
            _parse_chunks_response(
                [{"dataset_id": DATASET_ID, "search_result": [CHUNK]}], DATASET_ID, False
            )

    def test_acl_enabled_accepts_the_exact_requested_dataset_envelope(self) -> None:
        response = [
            {
                "dataset_id": DATASET_ID,
                "dataset_name": "authorized",
                "dataset_tenant_id": "tenant-one",
                "search_result": [CHUNK],
            }
        ]
        self.assertEqual(_parse_chunks_response(response, DATASET_ID, True), [CHUNK])

    def test_acl_enabled_rejects_a_wrong_or_missing_dataset_identity(self) -> None:
        for envelope in (
            {"dataset_id": "dataset-two", "search_result": [CHUNK]},
            {"search_result": [CHUNK]},
        ):
            with self.subTest(envelope=envelope):
                with self.assertRaisesRegex(AssertionError, "different dataset"):
                    _parse_chunks_response([envelope], DATASET_ID, True)

    def test_acl_enabled_rejects_missing_or_extra_dataset_envelopes(self) -> None:
        with self.assertRaisesRegex(AssertionError, "exactly one dataset envelope"):
            _parse_chunks_response([], DATASET_ID, True)
        with self.assertRaisesRegex(AssertionError, "exactly one dataset envelope"):
            _parse_chunks_response(
                [
                    {"dataset_id": DATASET_ID, "search_result": [CHUNK]},
                    {"dataset_id": "dataset-two", "search_result": [CHUNK]},
                ],
                DATASET_ID,
                True,
            )

    def test_acl_enabled_rejects_malformed_envelope_results(self) -> None:
        for result in (None, {}, ["not-a-chunk"]):
            with self.subTest(result=result):
                with self.assertRaisesRegex(AssertionError, "dataset result is not a list"):
                    _parse_chunks_response(
                        [{"dataset_id": DATASET_ID, "search_result": result}], DATASET_ID, True
                    )


if __name__ == "__main__":
    unittest.main()
