"""Focused checks for the Cognee 1.5.4 provider qualification driver."""

import argparse
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from v1_5_4 import provider_contract
from v1_5_4.provider_contract import _deletion_restart_result, _failure_result
from v1_5_4.provider_isolation_contract import (
    dataset_members,
    graph_document_chunk_coordinates,
    safe_search_coordinates,
)


DATASET_ID = "80f052ea-9cc7-4596-b33e-e623dc1a6525"
DOCUMENT_ID = "b57331b7-25fb-4596-a094-0750f3fb3173"
CHUNK_ID = "0820b25d-d1ea-4b4b-b9a4-aa8e4d4fdacf"
FOREIGN_DOCUMENT_ID = "48a20e49-7296-438f-9d49-9e47a496a2a3"
FOREIGN_CHUNK_ID = "2e145ccf-fbcf-4080-b3b7-ebfac94693d6"


class _Api:
    def __init__(self, member: dict[str, str]):
        self.member = member

    def list_data(self, _dataset_id: str) -> list[dict[str, str]]:
        return [self.member]


class _GraphApi:
    def __init__(self, graph: object):
        self.graph_value = graph

    def graph(self, _dataset_id: str) -> object:
        return self.graph_value


class CandidateDatasetIdentityTest(unittest.TestCase):
    def test_accepts_only_members_owned_by_the_requested_dataset(self) -> None:
        members = dataset_members(
            _Api({"id": DOCUMENT_ID, "datasetId": DATASET_ID}), DATASET_ID
        )
        self.assertEqual(members[0]["id"], DOCUMENT_ID)
        invalid_members = (
            {"id": DOCUMENT_ID, "datasetId": "1d7a06d8-b602-48b9-9a79-6a91afbf7048"},
            {"id": DOCUMENT_ID, "dataset_id": DATASET_ID},
            {"id": DOCUMENT_ID},
        )
        for member in invalid_members:
            with self.subTest(member=member):
                with self.assertRaisesRegex(AssertionError, "owned by another dataset"):
                    dataset_members(_Api(member), DATASET_ID)

    def test_keeps_only_safe_ranked_search_coordinates(self) -> None:
        results = [
            {"id": FOREIGN_CHUNK_ID, "document_id": FOREIGN_DOCUMENT_ID, "text": "private"},
            {"id": CHUNK_ID, "document_id": DOCUMENT_ID, "text": "private"},
        ]

        self.assertEqual(
            safe_search_coordinates(results),
            [
                {"chunkId": FOREIGN_CHUNK_ID, "documentId": FOREIGN_DOCUMENT_ID},
                {"chunkId": CHUNK_ID, "documentId": DOCUMENT_ID},
            ],
        )

    def test_rejects_malformed_search_coordinates_and_retains_duplicates(self) -> None:
        invalid_results = (
            {"id": "not-a-uuid", "document_id": DOCUMENT_ID, "text": "private"},
            {"id": CHUNK_ID, "document_id": "not-a-uuid", "text": "private"},
            {"id": CHUNK_ID, "document_id": DOCUMENT_ID},
        )
        for result in invalid_results:
            with self.subTest(result=result):
                with self.assertRaises((AssertionError, ValueError)):
                    safe_search_coordinates([result])

        duplicate = {"id": CHUNK_ID, "document_id": DOCUMENT_ID, "text": "private"}
        self.assertEqual(
            safe_search_coordinates([duplicate, duplicate]),
            [
                {"chunkId": CHUNK_ID, "documentId": DOCUMENT_ID},
                {"chunkId": CHUNK_ID, "documentId": DOCUMENT_ID},
            ],
        )

    def test_keeps_only_graph_chunks_for_the_expected_document(self) -> None:
        graph = {
            "nodes": [
                {
                    "id": FOREIGN_CHUNK_ID,
                    "type": "DocumentChunk",
                    "properties": {"document_id": FOREIGN_DOCUMENT_ID, "text": "private"},
                },
                {
                    "id": CHUNK_ID,
                    "type": "DocumentChunk",
                    "properties": {"document_id": DOCUMENT_ID, "text": "private"},
                },
                {"id": DOCUMENT_ID, "type": "TextDocument", "properties": {}},
            ],
            "edges": [],
        }

        self.assertEqual(
            graph_document_chunk_coordinates(_GraphApi(graph), DATASET_ID, DOCUMENT_ID),
            [{"chunkId": CHUNK_ID, "documentId": DOCUMENT_ID}],
        )

    def test_rejects_malformed_graph_coordinates_and_retains_duplicates(self) -> None:
        invalid_nodes = (
            {"id": "not-a-uuid", "type": "DocumentChunk", "properties": {"document_id": DOCUMENT_ID}},
            {"id": CHUNK_ID, "type": "DocumentChunk", "properties": {}},
            {"id": CHUNK_ID, "type": "DocumentChunk", "properties": {"document_id": "not-a-uuid"}},
        )
        for node in invalid_nodes:
            with self.subTest(node=node):
                with self.assertRaises((AssertionError, ValueError)):
                    graph_document_chunk_coordinates(
                        _GraphApi({"nodes": [node], "edges": []}), DATASET_ID, DOCUMENT_ID
                    )

        duplicate = {
            "id": CHUNK_ID,
            "type": "DocumentChunk",
            "properties": {"document_id": DOCUMENT_ID},
        }
        self.assertEqual(
            graph_document_chunk_coordinates(
                _GraphApi({"nodes": [duplicate, duplicate], "edges": []}),
                DATASET_ID,
                DOCUMENT_ID,
            ),
            [
                {"chunkId": CHUNK_ID, "documentId": DOCUMENT_ID},
                {"chunkId": CHUNK_ID, "documentId": DOCUMENT_ID},
            ],
        )

    def test_deletion_restart_success_retains_prior_qualification(self) -> None:
        validated = {"authorizedDatasetId": DATASET_ID, "sourceGraphDelta": ["graph"]}
        result = _deletion_restart_result(validated, {"outcome": "pass"})

        self.assertEqual(result["authorizedDatasetId"], DATASET_ID)
        self.assertEqual(result["sourceGraphDelta"], ["graph"])
        self.assertEqual(result["deletionRecovery"], {"outcome": "pass"})

    def test_deletion_restart_failure_retains_prior_qualification_and_evidence(self) -> None:
        class _Failure(AssertionError):
            evidence = {"outcome": "fail", "originalBytesPresentAfterRetry": True}

        result = _failure_result(
            {"authorizedDatasetId": DATASET_ID, "sharedDocumentId": DOCUMENT_ID},
            "deletion-restart",
            "acl-enabled",
            _Failure("retained bytes"),
        )

        self.assertEqual(result["authorizedDatasetId"], DATASET_ID)
        self.assertEqual(result["sharedDocumentId"], DOCUMENT_ID)
        self.assertEqual(result["outcome"], "fail")
        self.assertEqual(result["deletionRecovery"], _Failure.evidence)

    def test_restart_authentication_failure_retains_persisted_evidence(self) -> None:
        class _AuthenticationFailureApi:
            def __init__(self, _base_url: str):
                pass

            def authenticate(self, _email: str, _password: str, register: bool) -> None:
                if register:
                    raise AssertionError("Recovery attempted to register another user")
                raise RuntimeError("login unavailable")

        with tempfile.TemporaryDirectory() as directory:
            state_path = Path(directory) / "state.json"
            output_path = Path(directory) / "output.json"
            state_path.write_text(
                json.dumps({"authorizedDatasetId": DATASET_ID}), encoding="utf-8"
            )
            arguments = argparse.Namespace(
                phase="deletion-restart",
                mode="acl-enabled",
                namespace="test",
                output=str(output_path),
                state=str(state_path),
                base_url="http://cognee:8000",
                drop_proxy="drop-proxy:8091",
            )
            with (
                patch.object(provider_contract, "_arguments", return_value=arguments),
                patch.object(provider_contract, "ProviderApi", _AuthenticationFailureApi),
                self.assertRaisesRegex(RuntimeError, "login unavailable"),
            ):
                provider_contract.main()

            result = json.loads(output_path.read_text(encoding="utf-8"))
            self.assertEqual(result["authorizedDatasetId"], DATASET_ID)
            self.assertEqual(result["outcome"], "fail")
            self.assertEqual(result["failureType"], "RuntimeError")

    def test_recovery_failure_retains_shared_retrieval_coordinates(self) -> None:
        evidence = {
            "datasetId": DATASET_ID,
            "documentId": DOCUMENT_ID,
            "topK": 20,
            "graphAssociatedCount": 1,
            "returnedAssociatedCount": 0,
            "graphCoordinates": [{"chunkId": CHUNK_ID, "documentId": DOCUMENT_ID}],
            "searchCoordinates": [
                {"chunkId": FOREIGN_CHUNK_ID, "documentId": FOREIGN_DOCUMENT_ID}
            ],
        }

        class _AuthenticatedApi:
            instances = 0

            def __init__(self, _base_url: str):
                self.index = self.instances
                _AuthenticatedApi.instances += 1

            def authenticate(self, _email: str, _password: str, register: bool) -> None:
                if register and self.index == 0:
                    raise AssertionError("Recovery attempted to register another user")

        async def _verify_acl(
            _api: object,
            _state: object,
            _namespace: str,
            _foreign_api: object,
        ) -> dict:
            return {}

        def _fail_recovery(_api: object, state: dict) -> dict:
            state["sharedRetrievalEvidence"] = evidence
            raise AssertionError("Second dataset membership did not retain distinct chunks")

        with tempfile.TemporaryDirectory() as directory:
            state_path = Path(directory) / "state.json"
            output_path = Path(directory) / "output.json"
            state_path.write_text(
                json.dumps({"authorizedDatasetId": DATASET_ID}), encoding="utf-8"
            )
            arguments = argparse.Namespace(
                phase="recovery",
                mode="acl-enabled",
                namespace="test",
                output=str(output_path),
                state=str(state_path),
                base_url="http://cognee:8000",
                drop_proxy="drop-proxy:8091",
            )
            with (
                patch.object(provider_contract, "_arguments", return_value=arguments),
                patch.object(provider_contract, "ProviderApi", _AuthenticatedApi),
                patch.object(
                    provider_contract,
                    "verify_dataset_provisioning_after_restart",
                    return_value={},
                ),
                patch.object(
                    provider_contract,
                    "verify_dataset_acl_recovery_after_restart",
                    _verify_acl,
                ),
                patch.object(
                    provider_contract,
                    "verify_cognify_recovery_after_restart",
                    return_value={},
                ),
                patch.object(provider_contract, "recover_identity", _fail_recovery),
                self.assertRaisesRegex(AssertionError, "distinct chunks"),
            ):
                provider_contract.main()

            result = json.loads(output_path.read_text(encoding="utf-8"))
            self.assertEqual(result["sharedRetrievalEvidence"], evidence)
            self.assertEqual(result["outcome"], "fail")


if __name__ == "__main__":
    unittest.main()
