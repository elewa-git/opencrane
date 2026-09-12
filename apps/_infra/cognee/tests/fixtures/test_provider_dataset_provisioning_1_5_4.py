#!/usr/bin/env python3
"""Verify the 1.5.4 dataset provisioning qualification stays fail closed."""

import argparse
import json
import tempfile
import threading
import unittest
import uuid
from collections import Counter
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, patch

from v1_5_4 import provider_contract
from v1_5_4 import provider_dataset_provisioning_contract as contract


OWNER_ID = str(uuid.uuid4())


class _Api:
    def __init__(self) -> None:
        self.base_url = "http://cognee:8000"
        self._access_token = "synthetic-token"
        self.created_names: list[str] = []
        self.rows: dict[str, dict[str, str]] = {}
        self._lock = threading.Lock()

    def create_dataset(self, name: str) -> dict[str, str]:
        with self._lock:
            self.created_names.append(name)
            row = self.rows.setdefault(
                name,
                {
                    "id": str(uuid.uuid5(uuid.UUID(OWNER_ID), name)),
                    "name": name,
                    "ownerId": OWNER_ID,
                },
            )
            return dict(row)

    def json(self, method: str, path: str, value: Any | None = None) -> Any:
        if (method, path, value) != ("GET", "/api/v1/datasets", None):
            raise AssertionError("unexpected provider call")
        with self._lock:
            return [dict(row) for row in self.rows.values()]


class _Connection:
    instances: list["_Connection"] = []

    def __init__(self, host: str, port: int, timeout: int) -> None:
        self.host = host
        self.port = port
        self.timeout = timeout
        self.requests: list[tuple[str, str, bytes, dict[str, str]]] = []
        self.closed = False
        self.instances.append(self)

    def request(
        self, method: str, path: str, body: bytes, headers: dict[str, str]
    ) -> None:
        self.requests.append((method, path, body, headers))

    def close(self) -> None:
        self.closed = True


class ProviderDatasetProvisioning154Test(unittest.TestCase):
    def test_authenticated_initial_phase_persists_provisioning_evidence(self) -> None:
        dataset_evidence = {
            "stable": {
                "datasetId": str(uuid.uuid4()),
                "name": "ocm-stable",
                "ownerId": OWNER_ID,
            }
        }
        acl_evidence = {"faults": [], "concurrent": dataset_evidence["stable"]}

        class _AuthenticatedApi:
            def __init__(self, _base_url: str) -> None:
                pass

            def authenticate(self, _email: str, _password: str, register: bool) -> None:
                if not register:
                    raise AssertionError("Initial qualification did not register its user")

        with tempfile.TemporaryDirectory() as directory:
            state_path = Path(directory) / "state.json"
            output_path = Path(directory) / "output.json"
            arguments = argparse.Namespace(
                phase="initial",
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
                    "qualify_dataset_provisioning",
                    return_value=dataset_evidence,
                ),
                patch.object(
                    provider_contract,
                    "prepare_dataset_acl_recovery",
                    AsyncMock(return_value=acl_evidence),
                ),
                patch.object(
                    provider_contract,
                    "prepare_isolation",
                    return_value={"authorizedDatasetId": str(uuid.uuid4())},
                ),
                patch.object(
                    provider_contract,
                    "prepare_identity",
                    side_effect=lambda _api, evidence, _proxy: evidence,
                ),
            ):
                provider_contract.main()

            state = json.loads(state_path.read_text(encoding="utf-8"))
            output = json.loads(output_path.read_text(encoding="utf-8"))
            self.assertEqual(state["datasetProvisioning"], dataset_evidence)
            self.assertEqual(state["datasetAclRecovery"], acl_evidence)
            self.assertEqual(output, state)

    def test_qualification_uses_one_saved_name_for_each_effect(self) -> None:
        api = _Api()

        def drop_response(target: _Api, name: str) -> None:
            target.create_dataset(name)

        evidence = contract.qualify_dataset_provisioning(
            api, "synthetic-run", drop_response=drop_response
        )

        counts = Counter(api.created_names)
        self.assertEqual(sorted(counts.values()), [1, 2, 4])
        self.assertEqual(set(counts), {item["name"] for item in evidence.values()})
        self.assertEqual({item["ownerId"] for item in evidence.values()}, {OWNER_ID})
        self.assertEqual(len({item["datasetId"] for item in evidence.values()}), 3)

    def test_restart_requires_every_exact_saved_coordinate(self) -> None:
        api = _Api()
        names = [contract._opaque_name("synthetic-run", case) for case in range(3)]
        evidence = {
            case: contract._coordinate(api.create_dataset(name))
            for case, name in zip(
                ("stable", "concurrent", "droppedResponse"), names, strict=True
            )
        }

        self.assertEqual(
            contract.verify_dataset_provisioning_after_restart(api, evidence),
            evidence,
        )

        api.rows[names[1]] = {
            **api.rows[names[1]],
            "id": str(uuid.uuid4()),
        }
        with self.assertRaisesRegex(AssertionError, "unique saved dataset coordinate"):
            contract.verify_dataset_provisioning_after_restart(api, evidence)

    def test_reconciliation_rejects_absence_and_duplicate_owned_rows(self) -> None:
        api = _Api()
        name = contract._opaque_name("synthetic-run", "lost")
        with self.assertRaisesRegex(AssertionError, "did not become visible"):
            contract._recover_dropped_create(
                api, name, OWNER_ID, attempts=2, interval_seconds=0
            )

        api.rows["first"] = {"id": str(uuid.uuid4()), "name": name, "ownerId": OWNER_ID}
        api.rows["second"] = {"id": str(uuid.uuid4()), "name": name, "ownerId": OWNER_ID}
        with self.assertRaisesRegex(AssertionError, "duplicate rows"):
            contract._recover_dropped_create(
                api, name, OWNER_ID, attempts=1, interval_seconds=0
            )

    def test_reconciliation_ignores_same_name_owned_by_another_user(self) -> None:
        api = _Api()
        name = contract._opaque_name("synthetic-run", "lost")
        expected = {"id": str(uuid.uuid4()), "name": name, "ownerId": OWNER_ID}
        api.rows["foreign"] = {
            "id": str(uuid.uuid4()),
            "name": name,
            "ownerId": str(uuid.uuid4()),
        }
        api.rows["expected"] = expected

        self.assertEqual(
            contract._recover_dropped_create(
                api, name, OWNER_ID, attempts=1, interval_seconds=0
            ),
            {
                "datasetId": expected["id"],
                "name": name,
                "ownerId": OWNER_ID,
            },
        )

    def test_dropped_request_closes_without_reading_provider_response(self) -> None:
        api = _Api()
        _Connection.instances.clear()
        with patch.object(contract.http.client, "HTTPConnection", _Connection):
            contract._send_dataset_create_without_reading_response(api, "ocm-saved")

        self.assertEqual(len(_Connection.instances), 1)
        connection = _Connection.instances[0]
        self.assertEqual(
            (connection.host, connection.port, connection.timeout),
            ("cognee", 8000, 30),
        )
        self.assertTrue(connection.closed)
        self.assertEqual(len(connection.requests), 1)
        method, path, body, headers = connection.requests[0]
        self.assertEqual((method, path), ("POST", "/api/v1/datasets"))
        self.assertEqual(body, b'{"name":"ocm-saved"}')
        self.assertEqual(headers["content-length"], str(len(body)))
        self.assertEqual(headers["content-type"], "application/json")

    def test_coordinate_requires_wire_owner_and_valid_uuids(self) -> None:
        dataset_id = str(uuid.uuid4())
        invalid = (
            {"id": dataset_id, "name": "ocm-name", "owner_id": OWNER_ID},
            {"id": "not-a-uuid", "name": "ocm-name", "ownerId": OWNER_ID},
            {"id": dataset_id, "name": "ocm-name", "ownerId": "not-a-uuid"},
        )
        for value in invalid:
            with self.subTest(value=value):
                with self.assertRaises((AssertionError, ValueError)):
                    contract._coordinate(value)


if __name__ == "__main__":
    unittest.main()
