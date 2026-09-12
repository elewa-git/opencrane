"""Qualify Cognee 1.5.4 local-file deletion and retry boundaries."""

import asyncio
import hashlib
import json
import os
import shutil
import uuid
from pathlib import Path
from typing import TYPE_CHECKING, Any
from urllib.parse import unquote, urlparse

if TYPE_CHECKING:
    from provider_api import ProviderApi


class DeletionContractFailure(AssertionError):
    """Carry machine-readable evidence when retained bytes fail the hard gate."""

    def __init__(self, evidence: dict[str, Any]):
        self.evidence = evidence
        super().__init__(json.dumps(evidence, sort_keys=True))


class _ScalarResult:
    def scalar(self) -> int:
        return 0


class _NoReferenceSession:
    """Stub only the relational reference count used by the real cleanup helper."""

    async def __aenter__(self) -> "_NoReferenceSession":
        return self

    async def __aexit__(self, *_args: object) -> None:
        return None

    async def execute(self, _statement: object) -> _ScalarResult:
        return _ScalarResult()


class _NoReferenceAdapter:
    def get_async_session(self) -> _NoReferenceSession:
        return _NoReferenceSession()


class _InjectedCleanupFailure(RuntimeError):
    pass


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _local_file_path(location: str) -> Path:
    parsed = urlparse(location)
    if parsed.scheme != "file" or parsed.netloc not in ("", "localhost"):
        raise AssertionError("Deletion qualification requires provider-owned local file storage")
    return Path(unquote(parsed.path))


def _require_owned_path(path: Path, root: Path, *, must_exist: bool = True) -> Path:
    resolved_root = root.resolve()
    resolved_path = path.resolve(strict=must_exist)
    try:
        resolved_path.relative_to(resolved_root)
    except ValueError as error:
        raise AssertionError("Provider original-data path escaped DATA_ROOT_DIRECTORY") from error
    return resolved_path


async def _path_safety_probes() -> dict[str, Any]:
    """Invoke the installed cleanup helper with only its count query stubbed."""

    from cognee.infrastructure.databases.relational.sqlalchemy.SqlAlchemyAdapter import (
        SQLAlchemyAdapter,
    )

    data_root = Path(os.environ["DATA_ROOT_DIRECTORY"]).resolve()
    probe_id = uuid.uuid4().hex
    managed_directory = data_root / "opencrane-deletion-probes" / probe_id
    outside_directory = data_root.parent / f"{data_root.name}-opencrane-probe-{probe_id}"
    managed_file = managed_directory / "managed.bin"
    outside_file = outside_directory / "outside.bin"
    symlink_path = managed_directory / "outside-link"
    marker = hashlib.sha256(probe_id.encode("utf-8")).digest()
    managed_directory.mkdir(parents=True)
    outside_directory.mkdir(parents=True)
    managed_file.write_bytes(marker)
    outside_file.write_bytes(marker)
    symlink_path.symlink_to(outside_directory, target_is_directory=True)

    adapter = _NoReferenceAdapter()
    cleanup = SQLAlchemyAdapter.remove_data_file_if_unreferenced
    managed_location = managed_file.as_uri()
    sibling_location = outside_file.as_uri()
    traversal_location = (
        f"{data_root.as_uri()}/../{outside_directory.name}/{outside_file.name}"
    )
    symlink_location = (symlink_path / outside_file.name).as_uri()
    try:
        await cleanup(adapter, managed_location)
        if managed_file.exists():
            raise AssertionError("Installed cleanup helper did not remove a managed file")

        await cleanup(adapter, sibling_location)
        if not outside_file.is_file() or outside_file.read_bytes() != marker:
            raise AssertionError("Data-root substring matching removed an external sibling file")

        rejected = []
        for name, location in (
            ("parentTraversal", traversal_location),
            ("symlinkEscape", symlink_location),
        ):
            try:
                await cleanup(adapter, location)
            except ValueError:
                rejected.append(name)
            else:
                raise AssertionError(f"Installed local storage accepted {name}")
        if outside_file.read_bytes() != marker:
            raise AssertionError("A rejected containment probe changed the external file")

        return {
            "scope": (
                "Exact installed SQLAlchemyAdapter.remove_data_file_if_unreferenced and "
                "LocalFileStorage path resolution; only the relational count query returned zero."
            ),
            "managedLocation": managed_location,
            "managedRemoved": True,
            "substringSiblingLocation": sibling_location,
            "substringSiblingRetained": True,
            "rejectedCases": rejected,
        }
    finally:
        shutil.rmtree(managed_directory, ignore_errors=True)
        shutil.rmtree(outside_directory, ignore_errors=True)


async def _data_locations(dataset_id: str, data_id: str) -> tuple[str, str] | None:
    from sqlalchemy import select

    from cognee.infrastructure.databases.relational import get_relational_engine
    from cognee.modules.data.models import Data

    engine = get_relational_engine()
    async with engine.get_async_session() as session:
        row = (
            await session.execute(
                select(Data).where(
                    Data.id == uuid.UUID(data_id),
                    Data.dataset_id == uuid.UUID(dataset_id),
                )
            )
        ).scalar_one_or_none()
    if row is None:
        return None
    return str(row.raw_data_location), str(row.original_data_location)


async def _delete_with_injected_original_cleanup_failure(
    dataset_id: str,
    data_id: str,
    original_location: str,
    adapter: Any = None,
) -> list[str]:
    """Run the installed adapter and fail when its post-commit original cleanup starts."""

    if adapter is None:
        from cognee.infrastructure.databases.relational import get_relational_engine

        adapter = get_relational_engine()
    cleanup_calls = []
    original_cleanup = adapter.remove_data_file_if_unreferenced

    async def fail_at_original(location: str | None) -> None:
        cleanup_calls.append(str(location))
        if str(location) == original_location:
            raise _InjectedCleanupFailure("injected original-file cleanup failure")
        await original_cleanup(location)

    had_instance_override = "remove_data_file_if_unreferenced" in adapter.__dict__
    prior_override = adapter.__dict__.get("remove_data_file_if_unreferenced")
    adapter.remove_data_file_if_unreferenced = fail_at_original
    try:
        try:
            await adapter.delete_data_entity(uuid.UUID(data_id), uuid.UUID(dataset_id))
        except _InjectedCleanupFailure:
            pass
        else:
            raise AssertionError("Injected post-commit cleanup failure was not reached")
    finally:
        if had_instance_override:
            adapter.remove_data_file_if_unreferenced = prior_override
        else:
            del adapter.remove_data_file_if_unreferenced

    if original_location not in cleanup_calls:
        raise AssertionError("Installed adapter did not attempt original-file cleanup")
    return cleanup_calls


def _only_member_id(api: "ProviderApi", dataset_id: str, content_digest: str) -> str:
    matching = []
    for member in api.list_data(dataset_id):
        data_id = member.get("id")
        member_dataset_id = member.get("datasetId")
        has_expected_digest = (
            isinstance(data_id, str)
            and hashlib.sha256(api.raw(dataset_id, data_id)).hexdigest() == content_digest
        )
        if member_dataset_id == dataset_id and has_expected_digest:
            matching.append(data_id)
    if len(matching) != 1:
        raise AssertionError("Fault fixture did not create exactly one digest-matched document")
    return matching[0]


def qualify_deletion_failure_and_path_safety(
    api: "ProviderApi", state: dict[str, Any]
) -> dict[str, Any]:
    """Prepare a committed-row deletion with an intentionally failed file cleanup."""

    namespace = str(state.get("authorizedDatasetId", "unknown"))[:8]
    dataset_id = str(
        api.create_dataset(f"opencrane-delete-fault-{namespace}-{uuid.uuid4().hex}")["id"]
    )
    marker = (
        f"opencrane synthetic deletion recovery marker {uuid.uuid4().hex}\n" * 4
    ).encode("utf-8")
    content_digest = hashlib.sha256(marker).hexdigest()
    api.add(dataset_id, "deletion-fault.txt", marker)
    data_id = _only_member_id(api, dataset_id, content_digest)

    async def prepare() -> dict[str, Any]:
        path_safety = await _path_safety_probes()
        locations = await _data_locations(dataset_id, data_id)
        if locations is None:
            raise AssertionError("Fault fixture Data row was absent before deletion")
        raw_location, original_location = locations
        data_root = Path(os.environ["DATA_ROOT_DIRECTORY"])
        original_path = _require_owned_path(_local_file_path(original_location), data_root)
        if _sha256(original_path) != content_digest:
            raise AssertionError("Stored original bytes did not match the synthetic upload")

        cleanup_calls = await _delete_with_injected_original_cleanup_failure(
            dataset_id, data_id, original_location
        )
        if await _data_locations(dataset_id, data_id) is not None:
            raise AssertionError("Injected cleanup failure rolled back the committed Data deletion")
        if not original_path.is_file() or _sha256(original_path) != content_digest:
            raise AssertionError("Injected cleanup failure did not retain the original bytes")

        return {
            "pathSafety": path_safety,
            "postCommitFailure": {
                "datasetId": dataset_id,
                "dataId": data_id,
                "contentSha256": content_digest,
                "rawDataLocation": raw_location,
                "originalDataLocation": original_location,
                "originalPath": str(original_path),
                "cleanupCalls": cleanup_calls,
                "rowPresentBefore": True,
                "rowPresentAfter": False,
                "originalBytesPresentAfter": True,
                "injectedAt": "original_data_location cleanup after relational commit",
            },
        }

    evidence = asyncio.run(prepare())
    if any(member.get("id") == data_id for member in api.list_data(dataset_id)):
        raise AssertionError("Public dataset read still listed the committed-deleted Data row")
    api.assert_raw_absent(dataset_id, data_id)
    print("CASE installed_cleanup_path_containment PASS")
    print("CASE post_commit_cleanup_failure_is_preserved_for_restart PASS")
    return evidence


def verify_deletion_failure_after_restart(
    api: "ProviderApi", evidence: dict[str, Any]
) -> dict[str, Any]:
    """Retry the same public coordinate and reject success while bytes remain."""

    failure = evidence.get("postCommitFailure")
    if not isinstance(failure, dict):
        raise AssertionError("Deletion restart evidence has no postCommitFailure object")
    dataset_id = failure.get("datasetId")
    data_id = failure.get("dataId")
    content_digest = failure.get("contentSha256")
    original_path_value = failure.get("originalPath")
    if not all(isinstance(value, str) and value for value in (
        dataset_id,
        data_id,
        content_digest,
        original_path_value,
    )):
        raise AssertionError("Deletion restart evidence has invalid coordinates")

    uuid.UUID(dataset_id)
    uuid.UUID(data_id)
    if len(content_digest) != 64:
        raise AssertionError("Deletion restart evidence has an invalid content digest")
    original_path = _require_owned_path(
        Path(original_path_value),
        Path(os.environ["DATA_ROOT_DIRECTORY"]),
        must_exist=False,
    )
    if any(member.get("id") == data_id for member in api.list_data(dataset_id)):
        raise AssertionError("Committed-deleted Data row reappeared after provider restart")
    api.assert_raw_absent(dataset_id, data_id)

    bytes_after_restart = original_path.is_file()
    if original_path.exists() and not bytes_after_restart:
        raise AssertionError("Provider original-data location is not a regular file")
    if bytes_after_restart and _sha256(original_path) != content_digest:
        raise AssertionError("Retained original bytes changed before the public retry")

    retry_attempted = False
    if bytes_after_restart:
        retry_attempted = True
        api.delete(dataset_id, data_id)
        api.assert_raw_absent(dataset_id, data_id)
    bytes_after_recovery = original_path.is_file()
    if bytes_after_recovery and _sha256(original_path) != content_digest:
        raise AssertionError("Public deletion retry changed retained bytes without removing them")

    result = {
        "datasetId": dataset_id,
        "dataId": data_id,
        "contentSha256": content_digest,
        "originalPath": str(original_path),
        "rowAbsentAfterRestart": True,
        "samePublicCoordinateAccepted": retry_attempted,
        "originalBytesPresentAfterRestart": bytes_after_restart,
        "originalBytesPresentAfterRecovery": bytes_after_recovery,
    }
    if bytes_after_recovery:
        result["outcome"] = "fail"
        result["reason"] = (
            "The same public deletion coordinate was accepted after restart while the exact "
            "provider-owned original bytes remained."
        )
        raise DeletionContractFailure(result)

    result["outcome"] = "pass"
    print("CASE post_commit_cleanup_failure_recovers_after_restart_or_retry PASS")
    return result
