#!/usr/bin/env python3
"""Qualify recovery of interrupted Cognee dataset access grants."""

import asyncio
import hashlib
import importlib
import uuid
from typing import Any, Protocol, TypedDict

from v1_5_4.provider_dataset_provisioning_contract import _coordinate, _opaque_name


_PERMISSIONS = ("read", "write", "delete", "share")
_FAULT_CASES = (
    ("row", 0),
    ("read", 1),
    ("write", 2),
    ("delete", 3),
    ("share", 4),
)


class DatasetAclApi(Protocol):
    """Provider calls used by dataset ACL recovery qualification."""

    def create_dataset(self, name: str) -> dict[str, Any]: ...

    def json(
        self, method: str, path: str, value: Any | None = None
    ) -> Any: ...

    def add(self, dataset_id: str, filename: str, content: bytes) -> Any: ...

    def list_data(self, dataset_id: str) -> list[dict[str, Any]]: ...

    def raw(self, dataset_id: str, document_id: str) -> bytes: ...

    def cognify(self, dataset_id: str) -> Any: ...

    def search(
        self, dataset_id: str, query_text: str, top_k: int = 10
    ) -> list[dict[str, Any]]: ...

    def delete(self, dataset_id: str, document_id: str) -> None: ...

    def assert_raw_absent(self, dataset_id: str, document_id: str) -> None: ...


class DatasetAclFault(TypedDict):
    """Safe coordinates retained for one interrupted grant sequence."""

    case: str
    datasetId: str
    name: str
    ownerId: str
    committedPermissions: list[str]


class _InjectedGrantFailure(RuntimeError):
    """Stop one fixture-owned grant sequence after a durable boundary."""


async def _user(owner_id: str) -> Any:
    """Load the authenticated provider owner whose UUID came from its own response."""
    from cognee.modules.users.methods import get_user

    return await get_user(uuid.UUID(owner_id))


async def _dataset_coordinate(name: str, owner_id: str) -> dict[str, str]:
    """Read one exact owner-scoped dataset row even before its read ACL exists."""
    from sqlalchemy import select

    from cognee.infrastructure.databases.relational import get_relational_engine
    from cognee.modules.data.models import Dataset

    engine = get_relational_engine()
    async with engine.get_async_session() as session:
        rows = list(
            (
                await session.scalars(
                    select(Dataset).where(
                        Dataset.name == name,
                        Dataset.owner_id == uuid.UUID(owner_id),
                    )
                )
            ).all()
        )
    if len(rows) != 1:
        raise AssertionError("Interrupted grant did not retain one exact owned dataset")
    row = rows[0]
    return {"datasetId": str(row.id), "name": str(row.name), "ownerId": str(row.owner_id)}


async def _permission_counts(dataset_id: str, principal_id: str) -> dict[str, int]:
    """Count each durable permission for one exact principal and dataset."""
    from sqlalchemy import func, select

    from cognee.infrastructure.databases.relational import get_relational_engine
    from cognee.modules.users.models import ACL, Permission

    engine = get_relational_engine()
    async with engine.get_async_session() as session:
        values = (
            await session.execute(
                select(Permission.name, func.count(ACL.id))
                .join(ACL, ACL.permission_id == Permission.id)
                .where(
                    ACL.dataset_id == uuid.UUID(dataset_id),
                    ACL.principal_id == uuid.UUID(principal_id),
                )
                .group_by(Permission.name)
            )
        ).all()
    counts = {str(name): int(count) for name, count in values}
    unexpected = set(counts) - set(_PERMISSIONS)
    if unexpected:
        raise AssertionError("Dataset ACL contains an unexpected permission")
    return {permission: counts.get(permission, 0) for permission in _PERMISSIONS}


def _require_counts(counts: dict[str, int], expected: tuple[str, ...]) -> None:
    """Require exactly one expected grant and no other owner grant."""
    for permission in _PERMISSIONS:
        wanted = 1 if permission in expected else 0
        if counts.get(permission) != wanted:
            raise AssertionError("Dataset ACL grant boundary differs from expected evidence")


async def _interrupt_after_grants(
    name: str, owner_id: str, completed_grants: int
) -> DatasetAclFault:
    """Create one dataset and stop after the selected committed owner grant."""
    module = importlib.import_module(
        "cognee.modules.data.methods.create_authorized_dataset"
    )
    owner = await _user(owner_id)
    original_grant = module.give_permission_on_dataset
    observed: list[str] = []

    async def stop_after_boundary(
        principal: Any, dataset_id: uuid.UUID, permission: str
    ) -> None:
        if len(observed) >= completed_grants:
            raise _InjectedGrantFailure("injected dataset ACL grant interruption")
        await original_grant(principal, dataset_id, permission)
        observed.append(permission)
        if len(observed) == completed_grants:
            raise _InjectedGrantFailure("injected dataset ACL grant interruption")

    module.give_permission_on_dataset = stop_after_boundary
    try:
        try:
            await module.create_authorized_dataset(name, owner)
        except _InjectedGrantFailure:
            pass
        else:
            raise AssertionError("Dataset ACL interruption was not reached")
    finally:
        module.give_permission_on_dataset = original_grant

    coordinate = await _dataset_coordinate(name, owner_id)
    counts = await _permission_counts(coordinate["datasetId"], owner_id)
    _require_counts(counts, tuple(observed))
    return {
        "case": _FAULT_CASES[completed_grants][0],
        **coordinate,
        "committedPermissions": list(observed),
    }


async def _cancelled_grant_releases_lock(
    name: str, owner_id: str
) -> dict[str, str]:
    """Cancel a held grant and require the same dataset lock to become available."""
    module = importlib.import_module(
        "cognee.modules.data.methods.create_authorized_dataset"
    )
    owner = await _user(owner_id)
    original_grant = module.give_permission_on_dataset
    grant_started = asyncio.Event()
    never_finish = asyncio.Event()

    async def wait_during_first_grant(
        _principal: Any, _dataset_id: uuid.UUID, _permission: str
    ) -> None:
        grant_started.set()
        await never_finish.wait()

    module.give_permission_on_dataset = wait_during_first_grant
    cancelled = asyncio.create_task(module.create_authorized_dataset(name, owner))
    try:
        await asyncio.wait_for(grant_started.wait(), timeout=2)
        cancelled.cancel()
        try:
            await cancelled
        except asyncio.CancelledError:
            pass
        else:
            raise AssertionError("Cancelled dataset grant task did not propagate cancellation")
    finally:
        module.give_permission_on_dataset = original_grant
        if not cancelled.done():
            cancelled.cancel()
            await asyncio.gather(cancelled, return_exceptions=True)

    recovered = await asyncio.wait_for(
        module.create_authorized_dataset(name, owner), timeout=3
    )
    coordinate = {
        "datasetId": str(recovered.id),
        "name": str(recovered.name),
        "ownerId": str(recovered.owner_id),
    }
    if coordinate["name"] != name or coordinate["ownerId"] != owner_id:
        raise AssertionError("Cancelled dataset recovery changed its owner")
    _require_counts(
        await _permission_counts(coordinate["datasetId"], owner_id), _PERMISSIONS
    )
    return coordinate


def _saved_fault(value: Any) -> DatasetAclFault:
    """Validate one persisted fault coordinate without accepting extra evidence."""
    required = {"case", "datasetId", "name", "ownerId", "committedPermissions"}
    if not isinstance(value, dict) or set(value) != required:
        raise AssertionError("Saved dataset ACL fault has an invalid shape")
    expected_counts = dict(_FAULT_CASES)
    if value.get("case") not in expected_counts:
        raise AssertionError("Saved dataset ACL fault has an unknown boundary")
    coordinate = _coordinate(
        {"id": value.get("datasetId"), "name": value.get("name"), "ownerId": value.get("ownerId")}
    )
    permissions = value.get("committedPermissions")
    if not isinstance(permissions, list) or permissions != list(
        _PERMISSIONS[: expected_counts[value["case"]]]
    ):
        raise AssertionError("Saved dataset ACL fault has invalid permission evidence")
    return {
        "case": value["case"],
        **coordinate,
        "committedPermissions": permissions,
    }


async def prepare_dataset_acl_recovery(
    api: DatasetAclApi, namespace: str, owner_id: str
) -> dict[str, Any]:
    """Persist five interrupted grants and one concurrent public creation."""
    faults = []
    for case, grant_count in _FAULT_CASES:
        name = _opaque_name(namespace, f"acl-{case}")
        fault = await _interrupt_after_grants(name, owner_id, grant_count)
        if fault["case"] != case:
            raise AssertionError("Dataset ACL fault case changed during preparation")
        faults.append(fault)

    concurrent_name = _opaque_name(namespace, "acl-concurrent")
    concurrent = await asyncio.gather(
        *[asyncio.to_thread(api.create_dataset, concurrent_name) for _index in range(4)]
    )
    coordinates = [_coordinate(value) for value in concurrent]
    if any(value != coordinates[0] for value in coordinates[1:]):
        raise AssertionError("Concurrent public dataset creation returned different coordinates")
    if coordinates[0]["ownerId"] != owner_id:
        raise AssertionError("Concurrent public dataset creation changed its owner")
    _require_counts(
        await _permission_counts(coordinates[0]["datasetId"], owner_id), _PERMISSIONS
    )

    cancellation = await _cancelled_grant_releases_lock(
        _opaque_name(namespace, "acl-cancelled"), owner_id
    )
    print("CASE dataset_acl_fault_boundaries_prepared PASS")
    print("CASE concurrent_dataset_acl_grants_remain_unique PASS")
    print("CASE cancelled_dataset_acl_grant_releases_lock PASS")
    return {
        "faults": faults,
        "concurrent": coordinates[0],
        "cancelled": cancellation,
    }


def _document_id(api: DatasetAclApi, dataset_id: str, content: bytes) -> str:
    """Resolve one added document by exact raw bytes inside its dataset."""
    expected = hashlib.sha256(content).hexdigest()
    matches = []
    for member in api.list_data(dataset_id):
        data_id = member.get("id")
        member_dataset_id = member.get("datasetId")
        if not isinstance(data_id, str) or member_dataset_id != dataset_id:
            continue
        uuid.UUID(data_id)
        if hashlib.sha256(api.raw(dataset_id, data_id)).hexdigest() == expected:
            matches.append(data_id)
    if len(matches) != 1:
        raise AssertionError("Recovered dataset did not contain one exact added document")
    return matches[0]


def _prove_public_operations(
    api: DatasetAclApi, dataset_id: str, name: str, owner_id: str, case: str
) -> str:
    """Prove read, write, search, and delete through authenticated public routes."""
    listed = api.json("GET", "/api/v1/datasets")
    if not isinstance(listed, list):
        raise AssertionError("Recovered dataset public list is not a list")
    matches = [
        _coordinate(item)
        for item in listed
        if isinstance(item, dict)
        and item.get("name") == name
        and item.get("ownerId") == owner_id
    ]
    expected = {"datasetId": dataset_id, "name": name, "ownerId": owner_id}
    if matches != [expected]:
        raise AssertionError("Recovered dataset is not uniquely visible through its public list")
    content = f"opencrane acl recovery {case} {uuid.uuid4().hex}\n".encode("utf-8")
    api.add(dataset_id, f"acl-{case}.txt", content)
    document_id = _document_id(api, dataset_id, content)
    api.cognify(dataset_id)
    facts = api.search(dataset_id, content.decode("utf-8").strip(), top_k=20)
    if not any(fact.get("document_id") == document_id for fact in facts):
        raise AssertionError("Recovered dataset search omitted its exact document coordinate")
    api.delete(dataset_id, document_id)
    if any(member.get("id") == document_id for member in api.list_data(dataset_id)):
        raise AssertionError("Recovered dataset delete left its document in the public list")
    api.assert_raw_absent(dataset_id, document_id)
    return document_id


async def verify_dataset_acl_recovery_after_restart(
    api: DatasetAclApi,
    evidence: Any,
    namespace: str,
    foreign_api: DatasetAclApi,
) -> dict[str, Any]:
    """Retry each saved name once, then prove exact grants and public operations."""
    if not isinstance(evidence, dict) or set(evidence) != {
        "faults",
        "concurrent",
        "cancelled",
    }:
        raise AssertionError("Saved dataset ACL recovery evidence has an invalid shape")
    values = evidence.get("faults")
    if not isinstance(values, list) or len(values) != len(_FAULT_CASES):
        raise AssertionError("Saved dataset ACL recovery evidence has no complete fault set")
    faults = [_saved_fault(value) for value in values]
    expected_cases = [case for case, _count in _FAULT_CASES]
    if [fault["case"] for fault in faults] != expected_cases:
        raise AssertionError("Saved dataset ACL fault order differs")
    for fault in faults:
        if fault["name"] != _opaque_name(namespace, f"acl-{fault['case']}"):
            raise AssertionError("Saved dataset ACL fault name differs from its exact operation")

    recovered = []
    for fault in faults:
        coordinate = _coordinate(api.create_dataset(fault["name"]))
        expected = {
            "datasetId": fault["datasetId"],
            "name": fault["name"],
            "ownerId": fault["ownerId"],
        }
        if coordinate != expected:
            raise AssertionError("Same-owner ACL recovery changed the saved dataset coordinate")
        _require_counts(
            await _permission_counts(fault["datasetId"], fault["ownerId"]),
            _PERMISSIONS,
        )
        document_id = await asyncio.to_thread(
            _prove_public_operations,
            api,
            fault["datasetId"],
            fault["name"],
            fault["ownerId"],
            fault["case"],
        )
        recovered.append({**expected, "case": fault["case"], "documentId": document_id})

    first = faults[0]
    foreign = _coordinate(foreign_api.create_dataset(first["name"]))
    if foreign["ownerId"] == first["ownerId"] or foreign["datasetId"] == first["datasetId"]:
        raise AssertionError("Foreign same-name creation adopted the owner's dataset")
    _require_counts(
        await _permission_counts(first["datasetId"], foreign["ownerId"]), ()
    )

    concurrent = _coordinate(
        {
            "id": evidence["concurrent"].get("datasetId"),
            "name": evidence["concurrent"].get("name"),
            "ownerId": evidence["concurrent"].get("ownerId"),
        }
    )
    if concurrent["name"] != _opaque_name(namespace, "acl-concurrent"):
        raise AssertionError("Saved concurrent dataset name differs from its exact operation")
    _require_counts(
        await _permission_counts(concurrent["datasetId"], concurrent["ownerId"]),
        _PERMISSIONS,
    )
    cancelled = _coordinate(
        {
            "id": evidence["cancelled"].get("datasetId"),
            "name": evidence["cancelled"].get("name"),
            "ownerId": evidence["cancelled"].get("ownerId"),
        }
    )
    if cancelled["name"] != _opaque_name(namespace, "acl-cancelled"):
        raise AssertionError("Saved cancelled dataset name differs from its exact operation")
    _require_counts(
        await _permission_counts(cancelled["datasetId"], cancelled["ownerId"]),
        _PERMISSIONS,
    )
    print("CASE interrupted_dataset_acl_grants_recover_after_restart PASS")
    print("CASE recovered_dataset_public_operations PASS")
    print("CASE foreign_same_name_cannot_adopt_owner_dataset PASS")
    return {
        "recovered": recovered,
        "concurrent": concurrent,
        "cancelled": cancelled,
        "foreign": foreign,
        "permissionCounts": {permission: 1 for permission in _PERMISSIONS},
    }
