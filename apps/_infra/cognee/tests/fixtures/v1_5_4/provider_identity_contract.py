"""Prove 1.5.4 dataset-scoped identity, recovery, and exact deletion."""

import uuid
from typing import Any

from provider_api import ProviderApi
from v1_5_4.provider_isolation_contract import (
    AUTHORIZED,
    QUERY,
    assert_graph_contains,
    assert_graph_excludes,
    chunk_coordinates,
    digest,
    dataset_members,
    document_id,
    documents_for,
    graph_snapshot,
    local_storage_paths,
    member_by_digest,
    report_case,
)


RECOVERY = (
    "recovery-document survives a committed response that the caller never receives. " * 30
).encode()
CHANGED = (
    "changed-content uses the same upload filename but represents another durable source. " * 20
).encode()


def prepare_identity(
    api: ProviderApi, state: dict[str, Any], drop_proxy: str
) -> dict[str, Any]:
    dataset_id = state["authorizedDatasetId"]
    source_id = state["authorizedDocumentId"]
    before_replay = [document_id(item) for item in dataset_members(api, dataset_id)]
    api.add(dataset_id, "authorized.txt", AUTHORIZED)
    after_replay = [document_id(item) for item in dataset_members(api, dataset_id)]
    if after_replay != before_replay or after_replay.count(source_id) != 1:
        raise AssertionError("Same-content replay created a second dataset member")
    if api.raw(dataset_id, source_id) != AUTHORIZED:
        raise AssertionError("Raw source differs from the complete uploaded document")
    report_case("same_content_document_identity_is_stable")

    api.add(dataset_id, "authorized.txt", CHANGED)
    changed_id = document_id(member_by_digest(api, dataset_id, CHANGED))
    if changed_id == source_id:
        raise AssertionError("Changed content silently overwrote the prior document identity")
    if api.raw(dataset_id, source_id) != AUTHORIZED:
        raise AssertionError("Changed-content upload modified the prior raw source")
    report_case("same_filename_changed_content_creates_distinct_document_identity")

    proxy_host, proxy_port = drop_proxy.rsplit(":", 1)
    api.add_and_expect_dropped_response(
        proxy_host, int(proxy_port), dataset_id, "recovery.txt", RECOVERY
    )
    report_case("committed_add_response_is_dropped_after_provider_success")
    return {**state, "changedDocumentId": changed_id, "recoveryDigest": digest(RECOVERY)}


def recover_identity(api: ProviderApi, state: dict[str, Any]) -> dict[str, Any]:
    authorized_id = state["authorizedDatasetId"]
    foreign_id = state["foreignDatasetId"]
    authorized_document_id = state["authorizedDocumentId"]
    recovery_document_id = document_id(member_by_digest(api, authorized_id, RECOVERY))
    report_case("ambiguous_add_first_adopts_unique_member_and_full_digest_after_restart")

    api.add(authorized_id, "recovery.txt", RECOVERY)
    if document_id(member_by_digest(api, authorized_id, RECOVERY)) != recovery_document_id:
        raise AssertionError("Controlled replay changed the recovered document identity")
    api.cognify(authorized_id)
    recovery_chunks = documents_for(
        api.search(authorized_id, "recovery-document", top_k=10), recovery_document_id
    )
    if not recovery_chunks:
        raise AssertionError("Recovered document did not become searchable after restart")
    report_case("controlled_same_content_replay_does_not_duplicate_document")
    report_case("recovered_document_reaches_searchable_index_after_restart")

    foreign_baseline = graph_snapshot(api, foreign_id)
    if foreign_baseline != state["foreignGraphBaseline"]:
        raise AssertionError("Provider restart changed the prior foreign dataset graph")
    api.add(foreign_id, "authorized.txt", AUTHORIZED)
    api.cognify(foreign_id)
    shared_document_id = document_id(member_by_digest(api, foreign_id, AUTHORIZED))
    if shared_document_id == authorized_document_id:
        raise AssertionError("Identical content reused one document id across two datasets")
    shared_chunks = documents_for(
        api.search(foreign_id, "authorized-memory", top_k=20), shared_document_id
    )
    if len(set(shared_chunks)) < 2:
        raise AssertionError("Second dataset membership did not retain distinct chunks")
    assert_graph_contains(api, foreign_id, [shared_document_id, *shared_chunks])
    foreign_augmented = graph_snapshot(api, foreign_id)
    source_graph_delta = sorted(set(foreign_augmented) - set(foreign_baseline))
    if not source_graph_delta or not set(foreign_baseline).issubset(foreign_augmented):
        raise AssertionError("Cognify did not add source graph evidence without removing baseline")
    storage_paths = local_storage_paths(AUTHORIZED)
    if not storage_paths:
        raise AssertionError("Provider storage contains no complete source bytes before deletion")
    report_case("identical_content_has_dataset_scoped_document_identity")

    unknown_id = str(uuid.uuid4())
    api.delete(authorized_id, unknown_id)
    if api.raw(authorized_id, authorized_document_id) != AUTHORIZED:
        raise AssertionError("Deleting an unknown coordinate changed a known document")
    api.delete(authorized_id, authorized_document_id)
    api.assert_raw_absent(authorized_id, authorized_document_id)
    if any(
        document_id(item) == authorized_document_id
        for item in dataset_members(api, authorized_id)
    ):
        raise AssertionError("Deleted document remains listed in the source dataset")
    if api.raw(foreign_id, shared_document_id) != AUTHORIZED:
        raise AssertionError("First deletion changed the other dataset's source")
    assert_graph_excludes(
        api, authorized_id, [authorized_document_id, *state["authorizedChunkIds"]]
    )
    if authorized_document_id in [
        chunk_coordinates(result)[1] for result in api.search(authorized_id, QUERY, top_k=20)
    ]:
        raise AssertionError("Deleted document remains visible in source vector search")
    retained_documents = [
        chunk_coordinates(result)[1]
        for result in api.search(foreign_id, "authorized-memory", top_k=20)
    ]
    if shared_document_id not in retained_documents:
        raise AssertionError("Dataset-scoped retained document disappeared after first deletion")
    assert_graph_contains(api, foreign_id, [shared_document_id, *shared_chunks])
    if not local_storage_paths(AUTHORIZED):
        raise AssertionError("First deletion erased bytes still referenced by another dataset")
    report_case("first_dataset_delete_preserves_other_document_and_source_bytes")

    api.delete(foreign_id, shared_document_id)
    api.assert_raw_absent(foreign_id, shared_document_id)
    if any(document_id(item) == shared_document_id for item in dataset_members(api, foreign_id)):
        raise AssertionError("Last deletion left the dataset document listed")
    assert_graph_excludes(api, foreign_id, [shared_document_id, *shared_chunks])
    if shared_document_id in [
        chunk_coordinates(result)[1]
        for result in api.search(foreign_id, "authorized-memory", top_k=20)
    ]:
        raise AssertionError("Last deletion left vector chunks searchable")
    if graph_snapshot(api, foreign_id) != foreign_baseline:
        raise AssertionError("Last deletion did not restore the prior dataset graph")
    remaining_paths = local_storage_paths(AUTHORIZED)
    if remaining_paths:
        raise AssertionError(
            f"Last deletion left complete provider source bytes: {remaining_paths}"
        )
    report_case("last_dataset_delete_removes_source_bytes_document_chunks_and_graph")

    for source_id in (state["changedDocumentId"], recovery_document_id):
        api.delete(authorized_id, source_id)
        api.assert_raw_absent(authorized_id, source_id)

    from v1_5_4.provider_deletion_contract import qualify_deletion_failure_and_path_safety

    deletion_faults = qualify_deletion_failure_and_path_safety(api, state)
    return {
        **state,
        "recoveryDocumentId": recovery_document_id,
        "recoveryChunkIds": sorted(set(recovery_chunks)),
        "sharedChunkIds": sorted(set(shared_chunks)),
        "sharedDocumentId": shared_document_id,
        "sourceStoragePathsRemoved": storage_paths,
        "sourceGraphDelta": source_graph_delta,
        "unknownDeleteId": unknown_id,
        "deletionFaults": deletion_faults,
    }
