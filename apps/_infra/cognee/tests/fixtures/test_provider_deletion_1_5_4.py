#!/usr/bin/env python3
"""Verify the 1.5.4 deletion fault fixture cannot accept an orphaned source."""

import asyncio
import importlib.util
import json
import os
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch


MODULE_PATH = Path(__file__).parent / "v1_5_4" / "provider_deletion_contract.py"
SPEC = importlib.util.spec_from_file_location("provider_deletion_contract_1_5_4", MODULE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("Unable to load the 1.5.4 deletion contract fixture")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class _Api:
    def __init__(self, dataset_id: str, data_id: str):
        self.dataset_id = dataset_id
        self.data_id = data_id
        self.deleted = []

    def list_data(self, dataset_id: str) -> list[dict[str, str]]:
        if dataset_id != self.dataset_id:
            raise AssertionError("wrong dataset")
        return []

    def assert_raw_absent(self, dataset_id: str, data_id: str) -> None:
        if (dataset_id, data_id) != (self.dataset_id, self.data_id):
            raise AssertionError("wrong raw coordinate")

    def delete(self, dataset_id: str, data_id: str) -> None:
        self.deleted.append((dataset_id, data_id))


class _CommittedDeleteAdapter:
    def __init__(self, raw_location: str, original_location: str):
        self.raw_location = raw_location
        self.original_location = original_location
        self.row_present = True
        self.real_cleanup_calls = []

    async def remove_data_file_if_unreferenced(self, location: str) -> None:
        self.real_cleanup_calls.append(location)

    async def delete_data_entity(self, _data_id: uuid.UUID, _dataset_id: uuid.UUID) -> None:
        self.row_present = False
        await self.remove_data_file_if_unreferenced(self.raw_location)
        await self.remove_data_file_if_unreferenced(self.original_location)


class ProviderDeletion154Test(unittest.TestCase):
    def test_injection_occurs_after_commit_and_restores_the_adapter_method(self) -> None:
        dataset_id = str(uuid.uuid4())
        data_id = str(uuid.uuid4())
        adapter = _CommittedDeleteAdapter("file:///root/raw.txt", "file:///root/original.txt")
        original_method = adapter.remove_data_file_if_unreferenced

        calls = asyncio.run(
            MODULE._delete_with_injected_original_cleanup_failure(
                dataset_id,
                data_id,
                adapter.original_location,
                adapter,
            )
        )

        self.assertFalse(adapter.row_present)
        self.assertEqual(calls, [adapter.raw_location, adapter.original_location])
        self.assertEqual(adapter.real_cleanup_calls, [adapter.raw_location])
        self.assertEqual(
            adapter.remove_data_file_if_unreferenced.__func__, original_method.__func__
        )

    def test_restart_retry_raises_machine_readable_failure_when_bytes_remain(self) -> None:
        dataset_id = str(uuid.uuid4())
        data_id = str(uuid.uuid4())
        marker = b"synthetic retained source"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            original = root / "owned" / "source.bin"
            original.parent.mkdir()
            original.write_bytes(marker)
            digest = MODULE.hashlib.sha256(marker).hexdigest()
            evidence = {
                "postCommitFailure": {
                    "datasetId": dataset_id,
                    "dataId": data_id,
                    "contentSha256": digest,
                    "originalPath": str(original),
                }
            }
            api = _Api(dataset_id, data_id)
            with patch.dict(os.environ, {"DATA_ROOT_DIRECTORY": directory}):
                with self.assertRaises(MODULE.DeletionContractFailure) as raised:
                    MODULE.verify_deletion_failure_after_restart(api, evidence)

        self.assertEqual(api.deleted, [(dataset_id, data_id)])
        machine_evidence = json.loads(str(raised.exception))
        self.assertEqual(machine_evidence["outcome"], "fail")
        self.assertTrue(machine_evidence["samePublicCoordinateAccepted"])
        self.assertTrue(machine_evidence["originalBytesPresentAfterRestart"])
        self.assertTrue(machine_evidence["originalBytesPresentAfterRecovery"])
        self.assertEqual(machine_evidence["contentSha256"], digest)

    def test_restart_retry_passes_only_when_public_retry_removes_exact_bytes(self) -> None:
        dataset_id = str(uuid.uuid4())
        data_id = str(uuid.uuid4())
        marker = b"synthetic recoverable source"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            original = root / "owned" / "source.bin"
            original.parent.mkdir()
            original.write_bytes(marker)
            digest = MODULE.hashlib.sha256(marker).hexdigest()
            evidence = {
                "postCommitFailure": {
                    "datasetId": dataset_id,
                    "dataId": data_id,
                    "contentSha256": digest,
                    "originalPath": str(original),
                }
            }
            api = _Api(dataset_id, data_id)

            def remove_on_retry(_dataset_id: str, _data_id: str) -> None:
                original.unlink()

            api.delete = remove_on_retry
            with patch.dict(os.environ, {"DATA_ROOT_DIRECTORY": directory}):
                result = MODULE.verify_deletion_failure_after_restart(api, evidence)

        self.assertEqual(result["outcome"], "pass")
        self.assertTrue(result["originalBytesPresentAfterRestart"])
        self.assertFalse(result["originalBytesPresentAfterRecovery"])

    def test_restart_passes_when_startup_already_removed_owned_original(self) -> None:
        dataset_id = str(uuid.uuid4())
        data_id = str(uuid.uuid4())
        digest = MODULE.hashlib.sha256(b"removed during startup").hexdigest()
        with tempfile.TemporaryDirectory() as directory:
            original = Path(directory) / "owned" / "removed-source.bin"
            evidence = {
                "postCommitFailure": {
                    "datasetId": dataset_id,
                    "dataId": data_id,
                    "contentSha256": digest,
                    "originalPath": str(original),
                }
            }
            api = _Api(dataset_id, data_id)
            with patch.dict(os.environ, {"DATA_ROOT_DIRECTORY": directory}):
                result = MODULE.verify_deletion_failure_after_restart(api, evidence)

        self.assertEqual(api.deleted, [])
        self.assertEqual(result["outcome"], "pass")
        self.assertFalse(result["samePublicCoordinateAccepted"])
        self.assertFalse(result["originalBytesPresentAfterRestart"])
        self.assertFalse(result["originalBytesPresentAfterRecovery"])

    def test_restart_rejects_missing_original_coordinate_outside_data_root(self) -> None:
        dataset_id = str(uuid.uuid4())
        data_id = str(uuid.uuid4())
        digest = MODULE.hashlib.sha256(b"outside root").hexdigest()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "data"
            root.mkdir()
            original = Path(directory) / "outside" / "removed-source.bin"
            evidence = {
                "postCommitFailure": {
                    "datasetId": dataset_id,
                    "dataId": data_id,
                    "contentSha256": digest,
                    "originalPath": str(original),
                }
            }
            api = _Api(dataset_id, data_id)
            with patch.dict(os.environ, {"DATA_ROOT_DIRECTORY": str(root)}):
                with self.assertRaisesRegex(AssertionError, "escaped DATA_ROOT_DIRECTORY"):
                    MODULE.verify_deletion_failure_after_restart(api, evidence)

        self.assertEqual(api.deleted, [])


if __name__ == "__main__":
    unittest.main()
