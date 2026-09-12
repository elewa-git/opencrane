"""Qualify Cognee 1.5.4 local-file deletion and retry boundaries."""

import asyncio
import hashlib
import json
import os
import shutil
import uuid
from contextlib import asynccontextmanager
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


class _InjectedCommitFailure(RuntimeError):
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
    sibling_suffix = str(outside_file).split(str(data_root), 1)[1].lstrip("/\\")
    substring_decoy = data_root / sibling_suffix
    marker = hashlib.sha256(probe_id.encode("utf-8")).digest()
    managed_directory.mkdir(parents=True)
    outside_directory.mkdir(parents=True)
    managed_file.write_bytes(marker)
    outside_file.write_bytes(marker)
    symlink_path.symlink_to(outside_directory, target_is_directory=True)
    substring_decoy.parent.mkdir(parents=True)
    substring_decoy.write_bytes(marker)

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
        if not substring_decoy.is_file() or substring_decoy.read_bytes() != marker:
            raise AssertionError("Data-root substring matching removed an in-root decoy file")

        retained = []
        for name, location in (
            ("parentTraversal", traversal_location),
            ("symlinkEscape", symlink_location),
            ("storageRoot", data_root.as_uri()),
            ("remoteFileHost", "file://other-host/provider-owned.bin"),
            ("remoteScheme", "s3://provider-bucket/provider-owned.bin"),
        ):
            await cleanup(adapter, location)
            retained.append(name)
        if outside_file.read_bytes() != marker:
            raise AssertionError("A containment probe changed the external file")

        return {
            "scope": (
                "Exact installed SQLAlchemyAdapter.remove_data_file_if_unreferenced and "
                "LocalFileStorage path resolution; only the relational count query returned zero."
            ),
            "managedLocation": managed_location,
            "managedRemoved": True,
            "substringSiblingLocation": sibling_location,
            "substringSiblingRetained": True,
            "substringDecoyRetained": True,
            "retainedCases": retained,
        }
    finally:
        shutil.rmtree(managed_directory, ignore_errors=True)
        shutil.rmtree(outside_directory, ignore_errors=True)
        shutil.rmtree(substring_decoy.parent, ignore_errors=True)


async def _lock_and_generator_probes() -> dict[str, Any]:
    """Exercise the installed task/process lock and item-generator cleanup paths."""

    from cognee.infrastructure.locks import managed_data_file_lock
    from cognee.modules.pipelines.operations.run_tasks_data_item import (
        _drain_and_close_item_events,
    )

    child_timed_out = False
    process_timed_out = False
    async with managed_data_file_lock(timeout_seconds=1):
        async def contend() -> None:
            async with managed_data_file_lock(timeout_seconds=0.1):
                raise AssertionError("Child task bypassed the managed-file lock")

        try:
            await asyncio.create_task(contend())
        except TimeoutError:
            child_timed_out = True

        runner = (
            "import asyncio\n"
            "from cognee.infrastructure.locks import managed_data_file_lock\n"
            "async def attempt():\n"
            "    try:\n"
            "        async with managed_data_file_lock(0.1):\n"
            "            print('acquired')\n"
            "    except TimeoutError:\n"
            "        print('timeout')\n"
            "asyncio.run(attempt())\n"
        )
        process = await asyncio.create_subprocess_exec(
            "python",
            "-c",
            runner,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await process.communicate()
        if process.returncode != 0:
            raise AssertionError(
                f"Managed-file lock process probe failed: {stderr.decode('utf-8')}"
            )
        process_timed_out = stdout.decode("utf-8").strip() == "timeout"

    async with managed_data_file_lock(timeout_seconds=1):
        pass
    if not child_timed_out or not process_timed_out:
        raise AssertionError("Managed-file lock did not serialize task and process contenders")

    holder_runner = (
        "import asyncio\n"
        "from cognee.infrastructure.locks import managed_data_file_lock\n"
        "async def hold():\n"
        "    async with managed_data_file_lock(1):\n"
        "        print('acquired', flush=True)\n"
        "        await asyncio.Event().wait()\n"
        "asyncio.run(hold())\n"
    )
    holder = await asyncio.create_subprocess_exec(
        "python",
        "-c",
        holder_runner,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        if holder.stdout is None:
            raise AssertionError("Synthetic lock holder did not expose its output pipe")
        acquired_signal = await asyncio.wait_for(holder.stdout.readline(), timeout=2)
        if acquired_signal != b"acquired\n":
            raise AssertionError("Synthetic child did not acquire the managed-file lock")
        holder.terminate()
        await asyncio.wait_for(holder.wait(), timeout=2)
    finally:
        if holder.returncode is None:
            holder.terminate()
            try:
                await asyncio.wait_for(holder.wait(), timeout=1)
            except TimeoutError:
                holder.kill()
                await asyncio.wait_for(holder.wait(), timeout=1)
    async def acquire_after_process_exit() -> bool:
        async with managed_data_file_lock(timeout_seconds=1):
            return True

    released_after_process_exit = await asyncio.wait_for(
        asyncio.create_task(acquire_after_process_exit()), timeout=2
    )

    generator_closed = asyncio.Event()
    generator_started = asyncio.Event()
    generator_wait = asyncio.Event()

    async def waiting_generator():
        try:
            generator_started.set()
            yield {"started": True}
            await generator_wait.wait()
        finally:
            generator_closed.set()

    async def drain_waiting_generator() -> None:
        async with managed_data_file_lock(timeout_seconds=1):
            await _drain_and_close_item_events(
                waiting_generator(), None, [], "lock-probe", None
            )

    drain = asyncio.create_task(drain_waiting_generator())
    await asyncio.wait_for(generator_started.wait(), timeout=1)
    drain.cancel()
    try:
        await drain
    except asyncio.CancelledError:
        pass
    if not generator_closed.is_set():
        raise AssertionError("Cancelled add item did not close its generator")

    async def acquire_after_unwind() -> bool:
        async with managed_data_file_lock(timeout_seconds=1):
            return True

    released_after_cancellation = await asyncio.create_task(acquire_after_unwind())

    failed_generator_closed = False

    async def failing_generator():
        nonlocal failed_generator_closed
        try:
            yield {"started": True}
            raise _InjectedCleanupFailure("injected add item failure")
        finally:
            failed_generator_closed = True

    async def drain_failing_generator() -> None:
        async with managed_data_file_lock(timeout_seconds=1):
            await _drain_and_close_item_events(
                failing_generator(), None, [], "lock-probe", None
            )

    try:
        await drain_failing_generator()
    except _InjectedCleanupFailure:
        pass
    else:
        raise AssertionError("Injected add item failure was not propagated")
    if not failed_generator_closed:
        raise AssertionError("Failed add item did not close its generator")
    released_after_failure = await asyncio.create_task(acquire_after_unwind())

    return {
        "sameTaskReentrant": True,
        "childTaskTimedOut": child_timed_out,
        "competingProcessTimedOut": process_timed_out,
        "syntheticHolderExitCode": holder.returncode,
        "releasedAfterProcessExit": released_after_process_exit,
        "cancelledGeneratorClosed": True,
        "failedGeneratorClosed": True,
        "releasedAfterCancellation": released_after_cancellation,
        "releasedAfterFailure": released_after_failure,
    }


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


async def _create_document(
    api: "ProviderApi", dataset_name: str, filename: str, marker: bytes
) -> tuple[str, str, str]:
    dataset = await asyncio.to_thread(api.create_dataset, dataset_name)
    dataset_id = str(dataset["id"])
    await asyncio.to_thread(api.add, dataset_id, filename, marker)
    digest = hashlib.sha256(marker).hexdigest()
    data_id = await asyncio.to_thread(_only_member_id, api, dataset_id, digest)
    return dataset_id, data_id, digest


async def _require_document_absent(
    api: "ProviderApi", dataset_id: str, data_id: str
) -> None:
    members = await asyncio.to_thread(api.list_data, dataset_id)
    if any(member.get("id") == data_id for member in members):
        raise AssertionError("Concurrent deletion retained a Data row")
    await asyncio.to_thread(api.assert_raw_absent, dataset_id, data_id)


async def _shared_location_concurrency_probes(
    api: "ProviderApi", namespace: str
) -> dict[str, Any]:
    """Prove shared files survive either serialized add/delete order."""

    from cognee.infrastructure.databases.relational import get_relational_engine
    from cognee.infrastructure.locks import managed_data_file_lock

    data_root = Path(os.environ["DATA_ROOT_DIRECTORY"])
    marker = f"opencrane shared delete marker {uuid.uuid4().hex}\n".encode("utf-8")
    first = await _create_document(
        api, f"opencrane-delete-delete-a-{namespace}-{uuid.uuid4().hex}", "shared.txt", marker
    )
    second = await _create_document(
        api, f"opencrane-delete-delete-b-{namespace}-{uuid.uuid4().hex}", "shared.txt", marker
    )
    first_locations = await _data_locations(first[0], first[1])
    second_locations = await _data_locations(second[0], second[1])
    if first_locations is None or second_locations is None:
        raise AssertionError("Delete/delete qualification lost a prepared Data row")
    if first_locations[1] != second_locations[1]:
        raise AssertionError("Identical uploads did not share the original-data location")
    shared_path = _require_owned_path(_local_file_path(first_locations[1]), data_root)
    await asyncio.gather(
        asyncio.to_thread(api.delete, first[0], first[1]),
        asyncio.to_thread(api.delete, second[0], second[1]),
    )
    await _require_document_absent(api, first[0], first[1])
    await _require_document_absent(api, second[0], second[1])
    if shared_path.exists():
        raise AssertionError("Concurrent last-reference deletes orphaned the shared file")

    delete_first_marker = (
        f"opencrane delete-first add marker {uuid.uuid4().hex}\n"
    ).encode("utf-8")
    delete_first_source = await _create_document(
        api,
        f"opencrane-delete-first-source-{namespace}-{uuid.uuid4().hex}",
        "shared.txt",
        delete_first_marker,
    )
    delete_first_target = str(
        (await asyncio.to_thread(
            api.create_dataset,
            f"opencrane-delete-first-target-{namespace}-{uuid.uuid4().hex}",
        ))["id"]
    )
    async with managed_data_file_lock(timeout_seconds=1):
        add_task = asyncio.create_task(
            asyncio.to_thread(
                api.add,
                delete_first_target,
                "shared.txt",
                delete_first_marker,
            )
        )
        await asyncio.sleep(0.1)
        if add_task.done():
            raise AssertionError("Add pipeline bypassed the managed-file lock")
        await get_relational_engine().delete_data_entity(
            uuid.UUID(delete_first_source[1]), uuid.UUID(delete_first_source[0])
        )
    await add_task
    await _require_document_absent(api, delete_first_source[0], delete_first_source[1])
    delete_first_target_id = await asyncio.to_thread(
        _only_member_id,
        api,
        delete_first_target,
        hashlib.sha256(delete_first_marker).hexdigest(),
    )
    target_locations = await _data_locations(delete_first_target, delete_first_target_id)
    if target_locations is None:
        raise AssertionError("Delete-first ordering did not commit the waiting add")
    target_original = _require_owned_path(
        _local_file_path(target_locations[1]), data_root
    )
    if not target_original.is_file():
        raise AssertionError("Delete-first ordering committed a row without its original file")
    if _sha256(target_original) != hashlib.sha256(delete_first_marker).hexdigest():
        raise AssertionError("Delete-first ordering changed the committed original file")

    add_first_marker = f"opencrane add-first marker {uuid.uuid4().hex}\n".encode("utf-8")
    add_first_source = await _create_document(
        api,
        f"opencrane-add-first-source-{namespace}-{uuid.uuid4().hex}",
        "shared.txt",
        add_first_marker,
    )
    add_first_target = await _create_document(
        api,
        f"opencrane-add-first-target-{namespace}-{uuid.uuid4().hex}",
        "shared.txt",
        add_first_marker,
    )
    await asyncio.to_thread(api.delete, add_first_source[0], add_first_source[1])
    add_first_locations = await _data_locations(add_first_target[0], add_first_target[1])
    if add_first_locations is None:
        raise AssertionError("Add-first ordering lost the surviving Data row")
    add_first_original = _require_owned_path(
        _local_file_path(add_first_locations[1]), data_root
    )
    if not add_first_original.is_file():
        raise AssertionError("Add-first ordering left a committed row without its original file")
    if _sha256(add_first_original) != hashlib.sha256(add_first_marker).hexdigest():
        raise AssertionError("Add-first ordering changed the committed original file")

    await asyncio.to_thread(api.delete, delete_first_target, delete_first_target_id)
    await asyncio.to_thread(api.delete, add_first_target[0], add_first_target[1])
    return {
        "contentSha256": hashlib.sha256(marker).hexdigest(),
        "deleteDeleteSerialized": True,
        "deleteFirstAddBlocked": True,
        "deleteFirstCommittedSource": True,
        "addFirstRetainedSharedSource": True,
        "sharedFileRemovedAfterLastDelete": True,
    }


async def _delete_with_injected_original_cleanup_failure(
    dataset_id: str,
    data_id: str,
    original_location: str,
    adapter: Any = None,
) -> list[str]:
    """Fail the original-file cleanup while the installed adapter still owns its row."""

    if adapter is None:
        from cognee.infrastructure.databases.relational import get_relational_engine

        adapter = get_relational_engine()
    cleanup_calls = []
    original_cleanup = adapter._remove_data_file_if_unreferenced

    async def fail_at_original(
        session: Any,
        location: str | None,
        *,
        excluded_data_id: uuid.UUID | None = None,
    ) -> None:
        cleanup_calls.append(str(location))
        if str(location) == original_location:
            raise _InjectedCleanupFailure("injected original-file cleanup failure")
        await original_cleanup(
            session,
            location,
            excluded_data_id=excluded_data_id,
        )

    method_name = "_remove_data_file_if_unreferenced"
    had_instance_override = method_name in adapter.__dict__
    prior_override = adapter.__dict__.get(method_name)
    setattr(adapter, method_name, fail_at_original)
    try:
        try:
            await adapter.delete_data_entity(uuid.UUID(data_id), uuid.UUID(dataset_id))
        except _InjectedCleanupFailure:
            pass
        else:
            raise AssertionError("Injected post-commit cleanup failure was not reached")
    finally:
        if had_instance_override:
            setattr(adapter, method_name, prior_override)
        else:
            delattr(adapter, method_name)

    if original_location not in cleanup_calls:
        raise AssertionError("Installed adapter did not attempt original-file cleanup")
    return cleanup_calls


async def _delete_with_injected_commit_failure(
    dataset_id: str,
    data_id: str,
    adapter: Any = None,
) -> None:
    """Fail the final relational commit after both managed files have been removed."""

    if adapter is None:
        from cognee.infrastructure.databases.relational import get_relational_engine

        adapter = get_relational_engine()
    original_session_factory = adapter.get_async_session

    @asynccontextmanager
    async def failing_session():
        async with original_session_factory() as session:
            original_commit = session.commit

            async def fail_commit() -> None:
                raise _InjectedCommitFailure("injected final relational commit failure")

            session.commit = fail_commit
            try:
                yield session
            finally:
                session.commit = original_commit

    had_instance_override = "get_async_session" in adapter.__dict__
    prior_override = adapter.__dict__.get("get_async_session")
    adapter.get_async_session = failing_session
    try:
        try:
            await adapter.delete_data_entity(uuid.UUID(data_id), uuid.UUID(dataset_id))
        except _InjectedCommitFailure:
            pass
        else:
            raise AssertionError("Injected final relational commit failure was not reached")
    finally:
        if had_instance_override:
            adapter.get_async_session = prior_override
        else:
            del adapter.get_async_session


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
    """Prepare retryable file-cleanup and final-commit interruptions."""

    namespace = str(state.get("authorizedDatasetId", "unknown"))[:8]

    def create_document(case_name: str) -> tuple[str, str, str]:
        dataset_id = str(
            api.create_dataset(
                f"opencrane-delete-{case_name}-{namespace}-{uuid.uuid4().hex}"
            )["id"]
        )
        marker = (
            f"opencrane synthetic {case_name} deletion marker {uuid.uuid4().hex}\n" * 4
        ).encode("utf-8")
        content_digest = hashlib.sha256(marker).hexdigest()
        api.add(dataset_id, f"{case_name}.txt", marker)
        return dataset_id, _only_member_id(api, dataset_id, content_digest), content_digest

    cleanup_case = create_document("cleanup-failure")
    commit_case = create_document("commit-failure")

    async def prepare_case(
        coordinates: tuple[str, str, str], failure_kind: str
    ) -> dict[str, Any]:
        dataset_id, data_id, content_digest = coordinates
        locations = await _data_locations(dataset_id, data_id)
        if locations is None:
            raise AssertionError("Fault fixture Data row was absent before deletion")
        raw_location, original_location = locations
        data_root = Path(os.environ["DATA_ROOT_DIRECTORY"])
        raw_path = _require_owned_path(_local_file_path(raw_location), data_root)
        original_path = _require_owned_path(_local_file_path(original_location), data_root)
        if _sha256(original_path) != content_digest:
            raise AssertionError("Stored original bytes did not match the synthetic upload")

        cleanup_calls: list[str] = []
        if failure_kind == "originalCleanup":
            cleanup_calls = await _delete_with_injected_original_cleanup_failure(
                dataset_id, data_id, original_location
            )
            if not original_path.is_file() or _sha256(original_path) != content_digest:
                raise AssertionError("Cleanup interruption did not retain the original bytes")
        else:
            await _delete_with_injected_commit_failure(dataset_id, data_id)
            if raw_path.exists() or original_path.exists():
                raise AssertionError("Final-commit interruption occurred before file cleanup")

        if await _data_locations(dataset_id, data_id) is None:
            raise AssertionError("Interrupted deletion lost its relational retry coordinate")
        return {
            "datasetId": dataset_id,
            "dataId": data_id,
            "contentSha256": content_digest,
            "rawDataLocation": raw_location,
            "originalDataLocation": original_location,
            "rawPath": str(raw_path),
            "originalPath": str(original_path),
            "cleanupCalls": cleanup_calls,
            "rowPresentBefore": True,
            "rowPresentAfter": True,
            "rawBytesPresentAfter": raw_path.is_file(),
            "originalBytesPresentAfter": original_path.is_file(),
            "injectedAt": failure_kind,
        }

    async def prepare() -> dict[str, Any]:
        return {
            "pathSafety": await _path_safety_probes(),
            "managedFileLock": await _lock_and_generator_probes(),
            "sharedLocationConcurrency": await _shared_location_concurrency_probes(
                api, namespace
            ),
            "interruptions": {
                "originalCleanup": await prepare_case(cleanup_case, "originalCleanup"),
                "finalCommit": await prepare_case(commit_case, "finalCommit"),
            },
        }

    evidence = asyncio.run(prepare())
    for dataset_id, data_id, _digest in (cleanup_case, commit_case):
        if not any(member.get("id") == data_id for member in api.list_data(dataset_id)):
            raise AssertionError("Interrupted deletion disappeared from the public dataset read")
    print("CASE installed_cleanup_path_containment PASS")
    print("CASE interrupted_cleanup_preserves_retry_coordinates PASS")
    print("CASE interrupted_final_commit_preserves_retry_coordinates PASS")
    return evidence


def verify_deletion_failure_after_restart(
    api: "ProviderApi", evidence: dict[str, Any]
) -> dict[str, Any]:
    """Retry every interrupted public coordinate and require complete source removal."""

    interruptions = evidence.get("interruptions")
    if not isinstance(interruptions, dict) or set(interruptions) != {
        "originalCleanup",
        "finalCommit",
    }:
        raise AssertionError("Deletion restart evidence has invalid interruption cases")

    results = {
        name: _verify_interrupted_deletion(api, failure)
        for name, failure in interruptions.items()
    }
    print("CASE interrupted_deletion_recovers_after_restart_and_retry PASS")
    return {"outcome": "pass", "interruptions": results}


def _verify_interrupted_deletion(
    api: "ProviderApi", failure: Any
) -> dict[str, Any]:
    if not isinstance(failure, dict):
        raise AssertionError("Deletion restart evidence has an invalid interruption object")
    dataset_id = failure.get("datasetId")
    data_id = failure.get("dataId")
    content_digest = failure.get("contentSha256")
    raw_path_value = failure.get("rawPath")
    original_path_value = failure.get("originalPath")
    if not all(isinstance(value, str) and value for value in (
        dataset_id,
        data_id,
        content_digest,
        raw_path_value,
        original_path_value,
    )):
        raise AssertionError("Deletion restart evidence has invalid coordinates")

    uuid.UUID(dataset_id)
    uuid.UUID(data_id)
    if len(content_digest) != 64:
        raise AssertionError("Deletion restart evidence has an invalid content digest")
    data_root = Path(os.environ["DATA_ROOT_DIRECTORY"])
    raw_path = _require_owned_path(Path(raw_path_value), data_root, must_exist=False)
    original_path = _require_owned_path(
        Path(original_path_value),
        data_root,
        must_exist=False,
    )
    if not any(member.get("id") == data_id for member in api.list_data(dataset_id)):
        raise AssertionError("Interrupted Data row was absent after provider restart")

    raw_after_restart = raw_path.is_file()
    original_after_restart = original_path.is_file()
    if raw_path.exists() and not raw_after_restart:
        raise AssertionError("Provider raw-data location is not a regular file")
    if original_path.exists() and not original_after_restart:
        raise AssertionError("Provider original-data location is not a regular file")
    if original_after_restart and _sha256(original_path) != content_digest:
        raise AssertionError("Retained original bytes changed before the public retry")

    api.delete(dataset_id, data_id)
    if any(member.get("id") == data_id for member in api.list_data(dataset_id)):
        raise AssertionError("Public retry retained the interrupted Data row")
    api.assert_raw_absent(dataset_id, data_id)
    raw_after_recovery = raw_path.is_file()
    original_after_recovery = original_path.is_file()
    if original_after_recovery and _sha256(original_path) != content_digest:
        raise AssertionError("Public deletion retry changed retained bytes without removing them")

    result = {
        "datasetId": dataset_id,
        "dataId": data_id,
        "contentSha256": content_digest,
        "originalPath": str(original_path),
        "rowPresentAfterRestart": True,
        "samePublicCoordinateAccepted": True,
        "rawBytesPresentAfterRestart": raw_after_restart,
        "originalBytesPresentAfterRestart": original_after_restart,
        "rawBytesPresentAfterRecovery": raw_after_recovery,
        "originalBytesPresentAfterRecovery": original_after_recovery,
    }
    if raw_after_recovery or original_after_recovery:
        result["outcome"] = "fail"
        result["reason"] = (
            "The same public deletion coordinate was accepted after restart while the exact "
            "provider-owned source bytes remained."
        )
        raise DeletionContractFailure(result)

    result["outcome"] = "pass"
    return result
