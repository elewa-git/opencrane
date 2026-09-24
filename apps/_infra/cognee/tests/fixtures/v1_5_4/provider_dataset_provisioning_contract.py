"""Qualify deterministic and recoverable Cognee 1.5.4 dataset creation."""

import hashlib
import http.client
import json
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable, Protocol
from urllib.parse import urlsplit


class DatasetProvisioningApi(Protocol):
    """Expose the authenticated dataset calls used by this candidate fixture."""

    base_url: str
    _access_token: str | None

    def create_dataset(self, name: str) -> dict[str, Any]: ...

    def json(self, method: str, path: str, value: Any | None = None) -> Any: ...


DatasetCoordinate = dict[str, str]
DropDatasetResponse = Callable[[DatasetProvisioningApi, str], None]


def _opaque_name(namespace: str, case: str) -> str:
    """Derive a stable test name without placing user or tenant text in it."""
    digest = hashlib.sha256(f"{namespace}:{case}".encode()).hexdigest()
    return f"ocm-{digest}"


def _coordinate(value: Any) -> DatasetCoordinate:
    if not isinstance(value, dict):
        raise AssertionError("Dataset response is not an object")
    dataset_id = value.get("id")
    name = value.get("name")
    owner_id = value.get("ownerId")
    if not all(isinstance(item, str) and item for item in (dataset_id, name, owner_id)):
        raise AssertionError("Dataset response has no UUID, name, or owner")
    uuid.UUID(dataset_id)
    uuid.UUID(owner_id)
    return {"datasetId": dataset_id, "name": name, "ownerId": owner_id}


def _saved_coordinate(value: Any) -> DatasetCoordinate:
    if not isinstance(value, dict) or set(value) != {"datasetId", "name", "ownerId"}:
        raise AssertionError("Saved dataset coordinate has an invalid shape")
    dataset_id = value.get("datasetId")
    name = value.get("name")
    owner_id = value.get("ownerId")
    if not all(isinstance(item, str) and item for item in (dataset_id, name, owner_id)):
        raise AssertionError("Saved dataset coordinate has no UUID, name, or owner")
    uuid.UUID(dataset_id)
    uuid.UUID(owner_id)
    return {"datasetId": dataset_id, "name": name, "ownerId": owner_id}


def _listed_coordinates(api: DatasetProvisioningApi) -> list[DatasetCoordinate]:
    response = api.json("GET", "/api/v1/datasets")
    if not isinstance(response, list):
        raise AssertionError("Dataset listing is not a list")
    return [_coordinate(item) for item in response]


def _unique_owned_name(
    api: DatasetProvisioningApi, name: str, owner_id: str
) -> DatasetCoordinate | None:
    matches = [
        item
        for item in _listed_coordinates(api)
        if item["name"] == name and item["ownerId"] == owner_id
    ]
    if len(matches) > 1:
        raise AssertionError("Dataset listing contains duplicate rows for the saved name and owner")
    return matches[0] if matches else None


def _send_dataset_create_without_reading_response(
    api: DatasetProvisioningApi, name: str
) -> None:
    """Send one create command, then close before the client reads its response."""
    endpoint = urlsplit(api.base_url)
    if endpoint.scheme != "http" or not endpoint.hostname:
        raise AssertionError("Dropped-response qualification requires the internal HTTP endpoint")
    token = api._access_token
    if not isinstance(token, str) or not token:
        raise AssertionError("Dropped-response qualification requires authentication")
    payload = json.dumps({"name": name}, separators=(",", ":")).encode()
    connection = http.client.HTTPConnection(
        endpoint.hostname,
        endpoint.port or 80,
        timeout=30,
    )
    try:
        connection.request(
            "POST",
            f"{endpoint.path.rstrip('/')}/api/v1/datasets",
            body=payload,
            headers={
                "accept": "application/json",
                "authorization": f"Bearer {token}",
                "content-length": str(len(payload)),
                "content-type": "application/json",
            },
        )
    finally:
        connection.close()


def _recover_dropped_create(
    api: DatasetProvisioningApi,
    name: str,
    owner_id: str,
    *,
    attempts: int = 50,
    interval_seconds: float = 0.1,
) -> DatasetCoordinate:
    for attempt in range(attempts):
        coordinate = _unique_owned_name(api, name, owner_id)
        if coordinate is not None:
            return coordinate
        if attempt + 1 < attempts:
            time.sleep(interval_seconds)
    raise AssertionError("Dropped dataset create did not become visible during reconciliation")


def _same_coordinate(
    values: list[DatasetCoordinate], expected_name: str, expected_owner_id: str
) -> DatasetCoordinate:
    if not values:
        raise AssertionError("Dataset creation returned no coordinates")
    expected = values[0]
    if any(value != expected for value in values[1:]):
        raise AssertionError("Duplicate dataset creation returned different coordinates")
    if expected["name"] != expected_name or expected["ownerId"] != expected_owner_id:
        raise AssertionError("Dataset creation changed the saved name or authenticated owner")
    return expected


def qualify_dataset_provisioning(
    api: DatasetProvisioningApi,
    namespace: str,
    *,
    drop_response: DropDatasetResponse = _send_dataset_create_without_reading_response,
) -> dict[str, DatasetCoordinate]:
    """Prove same-owner replay, concurrent replay, and dropped-response adoption."""
    stable_name = _opaque_name(namespace, "stable")
    stable_values = [_coordinate(api.create_dataset(stable_name)) for _ in range(2)]
    stable = _same_coordinate(stable_values, stable_name, stable_values[0]["ownerId"])
    if _unique_owned_name(api, stable_name, stable["ownerId"]) != stable:
        raise AssertionError("Stable dataset identity is not uniquely listed for its owner")
    print("CASE dataset_create_replay_keeps_same_owner_coordinate PASS")

    concurrent_name = _opaque_name(namespace, "concurrent")
    with ThreadPoolExecutor(max_workers=4) as pool:
        concurrent_values = list(
            pool.map(lambda _index: _coordinate(api.create_dataset(concurrent_name)), range(4))
        )
    concurrent = _same_coordinate(concurrent_values, concurrent_name, stable["ownerId"])
    if _unique_owned_name(api, concurrent_name, stable["ownerId"]) != concurrent:
        raise AssertionError("Concurrent dataset replay did not leave one owned coordinate")
    print("CASE concurrent_dataset_create_replay_keeps_one_coordinate PASS")

    dropped_name = _opaque_name(namespace, "dropped-response")
    drop_response(api, dropped_name)
    dropped = _recover_dropped_create(api, dropped_name, stable["ownerId"])
    print("CASE dropped_dataset_create_response_recovers_saved_name_and_owner PASS")

    return {
        "stable": stable,
        "concurrent": concurrent,
        "droppedResponse": dropped,
    }


def verify_dataset_provisioning_after_restart(
    api: DatasetProvisioningApi, evidence: Any
) -> dict[str, DatasetCoordinate]:
    """Require every saved dataset coordinate after a fresh authentication."""
    expected_cases = ("stable", "concurrent", "droppedResponse")
    if not isinstance(evidence, dict) or set(evidence) != set(expected_cases):
        raise AssertionError("Saved dataset provisioning evidence has an invalid case set")
    saved = {case: _saved_coordinate(evidence[case]) for case in expected_cases}
    listed = _listed_coordinates(api)
    for case, expected in saved.items():
        matches = [
            item
            for item in listed
            if item["name"] == expected["name"] and item["ownerId"] == expected["ownerId"]
        ]
        if matches != [expected]:
            raise AssertionError(
                f"Restart did not retain the unique saved dataset coordinate for {case}"
            )
    print("CASE dataset_coordinates_survive_provider_restart PASS")
    return saved
