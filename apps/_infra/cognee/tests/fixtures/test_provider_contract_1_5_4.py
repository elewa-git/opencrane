"""Focused checks for the Cognee 1.5.4 provider qualification driver."""

import argparse
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from v1_5_4 import provider_contract
from v1_5_4.provider_contract import _deletion_restart_result, _failure_result
from v1_5_4.provider_isolation_contract import dataset_members


DATASET_ID = "80f052ea-9cc7-4596-b33e-e623dc1a6525"
DOCUMENT_ID = "b57331b7-25fb-4596-a094-0750f3fb3173"


class _Api:
    def __init__(self, member: dict[str, str]):
        self.member = member

    def list_data(self, _dataset_id: str) -> list[dict[str, str]]:
        return [self.member]


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


if __name__ == "__main__":
    unittest.main()
