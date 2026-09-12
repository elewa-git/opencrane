#!/usr/bin/env python3
"""Verify the 1.5.4 deletion fault fixture cannot accept an orphaned source."""

import asyncio
import importlib.util
import json
import os
import tempfile
import types
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
        self.row_present = True

    def list_data(self, dataset_id: str) -> list[dict[str, str]]:
        if dataset_id != self.dataset_id:
            raise AssertionError("wrong dataset")
        return [{"id": self.data_id, "datasetId": self.dataset_id}] if self.row_present else []

    def assert_raw_absent(self, dataset_id: str, data_id: str) -> None:
        if (dataset_id, data_id) != (self.dataset_id, self.data_id):
            raise AssertionError("wrong raw coordinate")

    def delete(self, dataset_id: str, data_id: str) -> None:
        self.deleted.append((dataset_id, data_id))
        self.row_present = False


class _MemberApi:
    def __init__(self, member: dict[str, str], content: bytes):
        self.member = member
        self.content = content

    def list_data(self, _dataset_id: str) -> list[dict[str, str]]:
        return [self.member]

    def raw(self, _dataset_id: str, _data_id: str) -> bytes:
        return self.content


class _CommittedDeleteAdapter:
    def __init__(self, raw_location: str, original_location: str):
        self.raw_location = raw_location
        self.original_location = original_location
        self.row_present = True
        self.real_cleanup_calls = []

    async def _remove_data_file_if_unreferenced(
        self,
        _session: object,
        location: str,
        *,
        excluded_data_id: uuid.UUID | None = None,
    ) -> None:
        if excluded_data_id is None:
            raise AssertionError("deletion did not exclude its own Data row")
        self.real_cleanup_calls.append(location)

    async def delete_data_entity(self, _data_id: uuid.UUID, _dataset_id: uuid.UUID) -> None:
        await self._remove_data_file_if_unreferenced(
            object(), self.raw_location, excluded_data_id=_data_id
        )
        await self._remove_data_file_if_unreferenced(
            object(), self.original_location, excluded_data_id=_data_id
        )
        self.row_present = False


class ProviderDeletion154Test(unittest.TestCase):
    def test_path_probe_inherits_the_provider_cleanup_helper_chain(self) -> None:
        calls = []

        class ProviderAdapter:
            def __init__(self) -> None:
                raise AssertionError("Path probes must not create a database engine")

            async def remove_data_file_if_unreferenced(self, location: str) -> None:
                async with self.get_async_session() as session:
                    await self._remove_data_file_if_unreferenced(session, location)

            async def _remove_data_file_if_unreferenced(
                self, session: object, location: str
            ) -> None:
                result = await session.execute(object())
                if result.scalar() != 0:
                    raise AssertionError("Path probes must stub only an absent reference")
                calls.append(location)
                # This double verifies method inheritance, not the provider's containment rule.
                if location.endswith("/managed.bin"):
                    MODULE._local_file_path(location).unlink()

        module_name = (
            "cognee.infrastructure.databases.relational.sqlalchemy.SqlAlchemyAdapter"
        )
        provider_module = types.ModuleType(module_name)
        provider_module.SQLAlchemyAdapter = ProviderAdapter
        with tempfile.TemporaryDirectory() as directory:
            data_root = Path(directory) / "data"
            data_root.mkdir()
            with (
                patch.dict("sys.modules", {module_name: provider_module}),
                patch.dict(os.environ, {"DATA_ROOT_DIRECTORY": str(data_root)}),
            ):
                evidence = asyncio.run(MODULE._path_safety_probes())

        self.assertEqual(len(calls), 7)
        self.assertTrue(evidence["managedRemoved"])
        self.assertTrue(evidence["substringSiblingRetained"])
        self.assertTrue(evidence["substringDecoyRetained"])
        self.assertEqual(
            evidence["retainedCases"],
            ["parentTraversal", "symlinkEscape", "storageRoot", "remoteFileHost", "remoteScheme"],
        )

    def test_member_discovery_requires_camel_case_dataset_owner(self) -> None:
        dataset_id = str(uuid.uuid4())
        data_id = str(uuid.uuid4())
        content = b"synthetic member"
        content_digest = MODULE.hashlib.sha256(content).hexdigest()

        discovered = MODULE._only_member_id(
            _MemberApi({"id": data_id, "datasetId": dataset_id}, content),
            dataset_id,
            content_digest,
        )
        self.assertEqual(discovered, data_id)

        invalid_members = (
            {"id": data_id, "datasetId": str(uuid.uuid4())},
            {"id": data_id, "dataset_id": dataset_id},
            {"id": data_id},
        )
        for member in invalid_members:
            with self.subTest(member=member):
                with self.assertRaisesRegex(AssertionError, "exactly one digest-matched"):
                    MODULE._only_member_id(
                        _MemberApi(member, content), dataset_id, content_digest
                    )

    def test_cleanup_failure_keeps_row_and_restores_the_adapter_method(self) -> None:
        dataset_id = str(uuid.uuid4())
        data_id = str(uuid.uuid4())
        adapter = _CommittedDeleteAdapter("file:///root/raw.txt", "file:///root/original.txt")
        original_method = adapter._remove_data_file_if_unreferenced

        calls = asyncio.run(
            MODULE._delete_with_injected_original_cleanup_failure(
                dataset_id,
                data_id,
                adapter.original_location,
                adapter,
            )
        )

        self.assertTrue(adapter.row_present)
        self.assertEqual(calls, [adapter.raw_location, adapter.original_location])
        self.assertEqual(adapter.real_cleanup_calls, [adapter.raw_location])
        self.assertEqual(
            adapter._remove_data_file_if_unreferenced.__func__, original_method.__func__
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
                    "rawPath": str(original),
                    "originalPath": str(original),
                }
            }
            api = _Api(dataset_id, data_id)
            with patch.dict(os.environ, {"DATA_ROOT_DIRECTORY": directory}):
                with self.assertRaises(MODULE.DeletionContractFailure) as raised:
                    MODULE._verify_interrupted_deletion(api, evidence["postCommitFailure"])

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
                    "rawPath": str(original),
                    "originalPath": str(original),
                }
            }
            api = _Api(dataset_id, data_id)

            def remove_on_retry(_dataset_id: str, _data_id: str) -> None:
                original.unlink()
                api.row_present = False

            api.delete = remove_on_retry
            with patch.dict(os.environ, {"DATA_ROOT_DIRECTORY": directory}):
                result = MODULE._verify_interrupted_deletion(
                    api, evidence["postCommitFailure"]
                )

        self.assertEqual(result["outcome"], "pass")
        self.assertTrue(result["originalBytesPresentAfterRestart"])
        self.assertFalse(result["originalBytesPresentAfterRecovery"])

    def test_restart_retries_row_when_files_are_already_absent(self) -> None:
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
                    "rawPath": str(original),
                    "originalPath": str(original),
                }
            }
            api = _Api(dataset_id, data_id)
            with patch.dict(os.environ, {"DATA_ROOT_DIRECTORY": directory}):
                result = MODULE._verify_interrupted_deletion(
                    api, evidence["postCommitFailure"]
                )

        self.assertEqual(api.deleted, [(dataset_id, data_id)])
        self.assertEqual(result["outcome"], "pass")
        self.assertTrue(result["samePublicCoordinateAccepted"])
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
                    "rawPath": str(original),
                    "originalPath": str(original),
                }
            }
            api = _Api(dataset_id, data_id)
            with patch.dict(os.environ, {"DATA_ROOT_DIRECTORY": str(root)}):
                with self.assertRaisesRegex(AssertionError, "escaped DATA_ROOT_DIRECTORY"):
                    MODULE._verify_interrupted_deletion(
                        api, evidence["postCommitFailure"]
                    )

        self.assertEqual(api.deleted, [])


if __name__ == "__main__":
    unittest.main()
