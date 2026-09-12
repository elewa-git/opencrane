#!/usr/bin/env python3
"""Verify the Cognee 1.5.4 dataset ACL recovery fixture and source patches."""

import argparse
import asyncio
import hashlib
import json
import sys
import tempfile
import types
import unittest
import uuid
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, patch

from v1_5_4 import provider_contract
from v1_5_4 import provider_dataset_acl_recovery_contract as contract


ROOT = Path(__file__).resolve().parents[5]
PATCHES = ROOT / "apps/_infra/cognee/tests/candidates/1.5.4/patches"
OWNER_ID = str(uuid.uuid4())


class _Api:
    def __init__(self, owner_id: str = OWNER_ID) -> None:
        self.owner_id = owner_id
        self.rows: dict[str, dict[str, str]] = {}
        self.documents: dict[str, bytes] = {}
        self.deleted: list[tuple[str, str]] = []

    def create_dataset(self, name: str) -> dict[str, str]:
        return self.rows.setdefault(
            name,
            {
                "id": str(uuid.uuid5(uuid.UUID(self.owner_id), name)),
                "name": name,
                "ownerId": self.owner_id,
            },
        )

    def json(self, method: str, path: str, value: Any | None = None) -> Any:
        if (method, path, value) != ("GET", "/api/v1/datasets", None):
            raise AssertionError("unexpected provider call")
        return list(self.rows.values())

    def add(self, dataset_id: str, _filename: str, content: bytes) -> None:
        self.documents[dataset_id] = content

    def list_data(self, dataset_id: str) -> list[dict[str, str]]:
        if dataset_id not in self.documents:
            return []
        return [{"id": str(uuid.uuid5(uuid.UUID(dataset_id), "document")), "datasetId": dataset_id}]

    def raw(self, dataset_id: str, _document_id: str) -> bytes:
        return self.documents[dataset_id]

    def cognify(self, _dataset_id: str) -> None:
        return None

    def search(self, dataset_id: str, _query_text: str, top_k: int = 10) -> list[dict[str, str]]:
        if top_k != 20:
            raise AssertionError("wrong search bound")
        return [{"document_id": self.list_data(dataset_id)[0]["id"], "id": str(uuid.uuid4())}]

    def delete(self, dataset_id: str, document_id: str) -> None:
        self.deleted.append((dataset_id, document_id))
        self.documents.pop(dataset_id)

    def assert_raw_absent(self, dataset_id: str, _document_id: str) -> None:
        if dataset_id in self.documents:
            raise AssertionError("raw source remains")


class ProviderDatasetAclRecovery154Test(unittest.TestCase):
    def test_patches_match_the_candidate_attestation_manifests(self) -> None:
        expected = json.loads(
            (PATCHES.parent / "expected-source-hashes.json").read_text(encoding="utf-8")
        )
        profile = json.loads(
            (PATCHES.parent / "profile.json").read_text(encoding="utf-8")
        )
        cases = (
            (
                "cognee.api.v1.datasets.routers.get_datasets_router",
                "dataset-route-acl-recovery.patch",
                "87b3ff9da756bbf730237197cdedcd26278f27e0c17f19ae887b77c9c0ccc241",
                "0f6226908897c14c97c17a449f715e461201e801a8bab5832b7fd0f8766a551e",
            ),
            (
                "cognee.modules.data.methods.create_authorized_dataset",
                "create-authorized-dataset-acl-recovery.patch",
                "cbdf60978470b0cba30fdb53aae00f4b4657390ae37294bcc9d31460150a91c9",
                "a3e261dbf13831b044cbf190fb9ac204150c88afc771b761a259c2430fbdb26b",
            ),
        )
        for module, patch_name, preimage, postimage in cases:
            with self.subTest(patch=patch_name):
                repair = expected["repairs"][module]
                self.assertEqual(repair["preimageSha256"], preimage)
                self.assertEqual(repair["postimageSha256"], postimage)
                self.assertEqual(
                    hashlib.sha256((PATCHES / patch_name).read_bytes()).hexdigest(),
                    repair["patchSha256"],
                )
                self.assertEqual(
                    profile["source"]["repairs"][module]["postimageSha256"], postimage
                )

    def test_route_patch_removes_the_acl_bypass(self) -> None:
        source_patch = (PATCHES / "dataset-route-acl-recovery.patch").read_text(
            encoding="utf-8"
        )
        self.assertIn("-from cognee.modules.data.methods import get_datasets_by_name", source_patch)
        self.assertIn("-            datasets = await get_datasets_by_name", source_patch)
        self.assertIn("             dataset = await create_authorized_dataset", source_patch)

    def test_authorized_dataset_patch_holds_one_lock_through_all_grants(self) -> None:
        source_patch = (PATCHES / "create-authorized-dataset-acl-recovery.patch").read_text(
            encoding="utf-8"
        )
        self.assertEqual(source_patch.count("+    async with dataset_lock(new_dataset.id):"), 1)
        self.assertIn("+            await give_permission_on_dataset(user", source_patch)
        self.assertIn("+                    await give_permission_on_dataset(parent", source_patch)

    def test_every_fault_stops_after_the_exact_durable_grant_prefix(self) -> None:
        async def exercise() -> None:
            for case, completed in contract._FAULT_CASES:
                module = types.ModuleType(
                    "cognee.modules.data.methods.create_authorized_dataset"
                )
                observed: list[str] = []

                async def grant(_principal: object, _dataset_id: uuid.UUID, permission: str) -> None:
                    observed.append(permission)

                async def create(name: str, principal: object) -> None:
                    for permission in contract._PERMISSIONS:
                        await module.give_permission_on_dataset(
                            principal, uuid.uuid5(uuid.UUID(OWNER_ID), name), permission
                        )

                module.give_permission_on_dataset = grant
                module.create_authorized_dataset = create
                coordinate = {
                    "datasetId": str(uuid.uuid4()),
                    "name": f"name-{case}",
                    "ownerId": OWNER_ID,
                }
                counts = {
                    permission: 1 if permission in contract._PERMISSIONS[:completed] else 0
                    for permission in contract._PERMISSIONS
                }
                with (
                    patch.dict(sys.modules, {module.__name__: module}),
                    patch.object(contract, "_user", AsyncMock(return_value=object())),
                    patch.object(
                        contract,
                        "_dataset_coordinate",
                        AsyncMock(return_value=coordinate),
                    ),
                    patch.object(
                        contract, "_permission_counts", AsyncMock(return_value=counts)
                    ),
                ):
                    evidence = await contract._interrupt_after_grants(
                        coordinate["name"], OWNER_ID, completed
                    )
                self.assertEqual(evidence["case"], case)
                self.assertEqual(evidence["committedPermissions"], list(observed))
                self.assertEqual(observed, list(contract._PERMISSIONS[:completed]))
                self.assertIs(module.give_permission_on_dataset, grant)

        asyncio.run(exercise())

    def test_cancelled_grant_releases_the_same_dataset_lock(self) -> None:
        async def exercise() -> None:
            module = types.ModuleType(
                "cognee.modules.data.methods.create_authorized_dataset"
            )
            lock = asyncio.Lock()
            dataset_id = uuid.uuid4()
            row = types.SimpleNamespace(
                id=dataset_id,
                name="cancelled-name",
                owner_id=uuid.UUID(OWNER_ID),
            )
            granted = []

            async def grant(
                _principal: object, _dataset_id: uuid.UUID, permission: str
            ) -> None:
                granted.append(permission)

            async def create(_name: str, principal: object) -> object:
                async with lock:
                    for permission in contract._PERMISSIONS:
                        await module.give_permission_on_dataset(
                            principal, dataset_id, permission
                        )
                    return row

            module.give_permission_on_dataset = grant
            module.create_authorized_dataset = create
            counts = {permission: 1 for permission in contract._PERMISSIONS}
            with (
                patch.dict(sys.modules, {module.__name__: module}),
                patch.object(contract, "_user", AsyncMock(return_value=object())),
                patch.object(
                    contract, "_permission_counts", AsyncMock(return_value=counts)
                ),
            ):
                coordinate = await contract._cancelled_grant_releases_lock(
                    row.name, OWNER_ID
                )
            self.assertEqual(coordinate["datasetId"], str(dataset_id))
            self.assertEqual(granted, list(contract._PERMISSIONS))
            self.assertFalse(lock.locked())

        asyncio.run(exercise())

    def test_restart_retries_exact_names_and_proves_public_operations(self) -> None:
        api = _Api()
        namespace = "synthetic"
        faults = []
        for case, completed in contract._FAULT_CASES:
            name = contract._opaque_name(namespace, f"acl-{case}")
            row = api.create_dataset(name)
            faults.append(
                {
                    "case": case,
                    "datasetId": row["id"],
                    "name": name,
                    "ownerId": OWNER_ID,
                    "committedPermissions": list(contract._PERMISSIONS[:completed]),
                }
            )
        concurrent_name = contract._opaque_name(namespace, "acl-concurrent")
        concurrent = contract._coordinate(api.create_dataset(concurrent_name))
        cancelled_name = contract._opaque_name(namespace, "acl-cancelled")
        cancelled = contract._coordinate(api.create_dataset(cancelled_name))
        foreign = _Api(str(uuid.uuid4()))

        async def counts(dataset_id: str, principal_id: str) -> dict[str, int]:
            expected = principal_id == OWNER_ID
            return {
                permission: int(expected) for permission in contract._PERMISSIONS
            }

        with patch.object(contract, "_permission_counts", counts):
            result = asyncio.run(
                contract.verify_dataset_acl_recovery_after_restart(
                    api,
                    {
                        "faults": faults,
                        "concurrent": concurrent,
                        "cancelled": cancelled,
                    },
                    namespace,
                    foreign,
                )
            )

        self.assertEqual(len(result["recovered"]), 5)
        self.assertEqual(len(api.deleted), 5)
        self.assertNotEqual(result["foreign"]["ownerId"], OWNER_ID)

    def test_saved_fault_rejects_wrong_case_prefix_and_extra_evidence(self) -> None:
        value = {
            "case": "read",
            "datasetId": str(uuid.uuid4()),
            "name": "saved-name",
            "ownerId": OWNER_ID,
            "committedPermissions": [],
        }
        with self.assertRaisesRegex(AssertionError, "permission evidence"):
            contract._saved_fault(value)
        with self.assertRaisesRegex(AssertionError, "invalid shape"):
            contract._saved_fault({**value, "token": "forbidden"})

    def test_recovery_phase_authenticates_fresh_users_and_persists_acl_evidence(self) -> None:
        acl_before = {"faults": [], "concurrent": {}}
        acl_after = {"recovered": [], "permissionCounts": {"read": 1}}
        provisioned = {"stable": {"ownerId": OWNER_ID}}
        instances = []

        class _AuthenticatedApi:
            def __init__(self, base_url: str) -> None:
                self.base_url = base_url
                self.authentications = []
                instances.append(self)

            def authenticate(self, email: str, password: str, register: bool) -> None:
                self.authentications.append((email, password, register))

        async def verify_acl(
            api: object, evidence: object, namespace: str, foreign_api: object
        ) -> dict[str, Any]:
            self.assertIs(api, instances[0])
            self.assertIs(foreign_api, instances[1])
            self.assertEqual(evidence, acl_before)
            self.assertEqual(namespace, "synthetic-run")
            return acl_after

        with tempfile.TemporaryDirectory() as directory:
            state_path = Path(directory) / "state.json"
            output_path = Path(directory) / "output.json"
            state_path.write_text(
                json.dumps(
                    {
                        "datasetProvisioning": provisioned,
                        "datasetAclRecovery": acl_before,
                    }
                ),
                encoding="utf-8",
            )
            arguments = argparse.Namespace(
                phase="recovery",
                mode="acl-enabled",
                namespace="synthetic-run",
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
                    return_value=provisioned,
                ),
                patch.object(
                    provider_contract,
                    "verify_dataset_acl_recovery_after_restart",
                    side_effect=verify_acl,
                ),
                patch.object(
                    provider_contract,
                    "recover_identity",
                    side_effect=lambda _api, evidence: evidence,
                ),
            ):
                provider_contract.main()

            output = json.loads(output_path.read_text(encoding="utf-8"))
            saved = json.loads(state_path.read_text(encoding="utf-8"))
            self.assertEqual(output["datasetAclRecovery"], acl_after)
            self.assertEqual(saved, output)
            self.assertFalse(instances[0].authentications[0][2])
            self.assertTrue(instances[1].authentications[0][2])


if __name__ == "__main__":
    unittest.main()
