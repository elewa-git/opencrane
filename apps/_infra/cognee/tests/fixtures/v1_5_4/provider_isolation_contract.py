"""Prove authenticated dataset isolation and useful 1.5.4 recall evidence."""

import hashlib
import json
import os
import uuid
from pathlib import Path
from typing import Any, Protocol

from provider_api import ProviderApi


QUERY = "isolation query"
AUTHORIZED = (
    "authorized-memory stores the blue crane migration note. " * 80
    + "\n\nOnly this dataset contains the approved source."
).encode()
FOREIGN = (
    "foreign-decoy isolation query must outrank the approved source globally. " * 80
    + "\n\nThis record belongs only to the other dataset."
).encode()


class DatasetDataReader(Protocol):
    def list_data(self, dataset_id: str) -> list[dict[str, Any]]: ...


def digest(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def document_id(item: dict[str, Any]) -> str:
    value = item.get("id")
    if not isinstance(value, str):
        raise AssertionError("Dataset member has no document id")
    uuid.UUID(value)
    return value


def dataset_members(api: DatasetDataReader, dataset_id: str) -> list[dict[str, Any]]:
    members = api.list_data(dataset_id)
    for member in members:
        if member.get("dataset_id") != dataset_id:
            raise AssertionError("Dataset data response contains a member owned by another dataset")
        document_id(member)
    return members


def chunk_coordinates(result: dict[str, Any]) -> tuple[str, str]:
    chunk_id = result.get("id")
    source_id = result.get("document_id")
    text = result.get("text")
    if not isinstance(chunk_id, str) or not isinstance(source_id, str) or not isinstance(text, str):
        raise AssertionError("CHUNKS result does not expose id, document_id, and text")
    uuid.UUID(chunk_id)
    uuid.UUID(source_id)
    if chunk_id == source_id:
        raise AssertionError("Cognee returned a document id as its chunk id")
    return chunk_id, source_id


def member_by_digest(api: ProviderApi, dataset_id: str, expected: bytes) -> dict[str, Any]:
    expected_digest = digest(expected)
    matches = [
        member
        for member in dataset_members(api, dataset_id)
        if digest(api.raw(dataset_id, document_id(member))) == expected_digest
    ]
    if len(matches) != 1:
        raise AssertionError(
            f"Expected one dataset member with digest {expected_digest}, received {len(matches)}"
        )
    return matches[0]


def report_case(name: str) -> None:
    print(f"CASE {name} PASS")


def local_storage_paths(content: bytes) -> list[str]:
    root = Path(os.environ["DATA_ROOT_DIRECTORY"])
    expected_digest = digest(content)
    paths = []
    for path in root.rglob("*"):
        is_candidate = path.is_file() and path.stat().st_size == len(content)
        if is_candidate and digest(path.read_bytes()) == expected_digest:
            paths.append(str(path))
    return sorted(set(paths))


def documents_for(results: list[dict[str, Any]], source_id: str) -> list[str]:
    return [chunk for chunk, document in map(chunk_coordinates, results) if document == source_id]


def graph_snapshot(api: ProviderApi, dataset_id: str) -> list[str]:
    graph = api.graph(dataset_id)
    if not isinstance(graph, dict):
        raise AssertionError("Dataset graph response is not an object")
    nodes = graph.get("nodes")
    edges = graph.get("edges")
    if not isinstance(nodes, list) or not isinstance(edges, list):
        raise AssertionError("Dataset graph response does not contain node and edge lists")
    if not all(isinstance(item, dict) for item in [*nodes, *edges]):
        raise AssertionError("Dataset graph contains a non-object node or edge")
    values = [f"node:{json.dumps(node, sort_keys=True)}" for node in nodes]
    values.extend(f"edge:{json.dumps(edge, sort_keys=True)}" for edge in edges)
    return sorted(hashlib.sha256(value.encode()).hexdigest() for value in values)


def assert_graph_contains(api: ProviderApi, dataset_id: str, coordinates: list[str]) -> None:
    graph_text = json.dumps(api.graph(dataset_id), sort_keys=True)
    if not any(coordinate in graph_text for coordinate in coordinates):
        raise AssertionError("Dataset graph has no document or chunk baseline for the source")


def assert_graph_excludes(api: ProviderApi, dataset_id: str, coordinates: list[str]) -> None:
    graph_text = json.dumps(api.graph(dataset_id), sort_keys=True)
    if any(coordinate in graph_text for coordinate in coordinates):
        raise AssertionError("Deleted source remains visible in the dataset graph")


def prepare_isolation(api: ProviderApi, namespace: str, mode: str) -> dict[str, Any]:
    authorized_id = str(api.create_dataset(f"{namespace}-{mode}-authorized")["id"])
    foreign_id = str(api.create_dataset(f"{namespace}-{mode}-foreign")["id"])
    if graph_snapshot(api, authorized_id) or graph_snapshot(api, foreign_id):
        raise AssertionError("New disposable dataset has graph content before ingestion")
    api.add(authorized_id, "authorized.txt", AUTHORIZED)
    api.add(foreign_id, "foreign.txt", FOREIGN)
    api.cognify(authorized_id)
    api.cognify(foreign_id)
    authorized_document_id = document_id(member_by_digest(api, authorized_id, AUTHORIZED))
    foreign_document_id = document_id(member_by_digest(api, foreign_id, FOREIGN))
    foreign_graph_baseline = graph_snapshot(api, foreign_id)
    if not foreign_graph_baseline:
        raise AssertionError("Foreign source did not produce a nonempty graph baseline")
    results = api.search(authorized_id, QUERY, top_k=1)
    if len(results) != 1:
        raise AssertionError(f"Isolation query returned {len(results)} results instead of one")
    chunk_id, recalled_document_id = chunk_coordinates(results[0])
    if mode == "acl-disabled":
        exposed_foreign = recalled_document_id == foreign_document_id
        if not exposed_foreign or recalled_document_id == authorized_document_id:
            raise AssertionError("ACL-disabled negative control did not expose the foreign chunk")
        report_case("acl_disabled_negative_control_detects_cross_dataset_chunk")
        return {
            "mode": mode,
            "authorizedDatasetId": authorized_id,
            "foreignDatasetId": foreign_id,
            "foreignDocumentId": foreign_document_id,
            "recalledDocumentId": recalled_document_id,
            "chunkId": chunk_id,
        }
    if recalled_document_id != authorized_document_id:
        raise AssertionError(
            "Authenticated search returned a document outside the requested dataset"
        )
    authorized_chunks = documents_for(
        api.search(authorized_id, "authorized-memory", top_k=20), authorized_document_id
    )
    if len(set(authorized_chunks)) < 2:
        raise AssertionError("Long source did not produce at least two distinct document chunks")
    assert_graph_contains(api, authorized_id, [authorized_document_id, *authorized_chunks])
    report_case("acl_enabled_chunks_are_dataset_scoped_and_useful")
    report_case("document_has_distinct_multi_chunk_and_graph_baseline")
    return {
        "mode": mode,
        "authorizedDatasetId": authorized_id,
        "foreignDatasetId": foreign_id,
        "authorizedDocumentId": authorized_document_id,
        "foreignDocumentId": foreign_document_id,
        "authorizedDigest": digest(AUTHORIZED),
        "initialChunkId": chunk_id,
        "authorizedChunkIds": sorted(set(authorized_chunks)),
        "foreignGraphBaseline": foreign_graph_baseline,
    }
