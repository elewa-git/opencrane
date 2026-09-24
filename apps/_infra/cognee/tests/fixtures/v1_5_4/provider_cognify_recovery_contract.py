"""Qualify exact Cognify recovery against the installed 1.5.4 candidate."""

import asyncio
import hashlib
import http.client
import json
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Protocol


class CognifyRecoveryApi(Protocol):
    """Expose only provider calls needed by the Cognify recovery contract."""

    _access_token: str | None

    def add(self, dataset_id: str, filename: str, content: bytes) -> Any: ...

    def create_dataset(self, name: str) -> dict[str, Any]: ...

    def delete(self, dataset_id: str, document_id: str) -> None: ...

    def json(
        self,
        method: str,
        path: str,
        value: Any | None = None,
        timeout: int = 300,
        accepted: tuple[int, ...] = (200,),
    ) -> Any: ...


def _opaque_name(namespace: str) -> str:
    digest = hashlib.sha256(f"{namespace}:cognify-recovery".encode()).hexdigest()
    return f"ocm-{digest}"


def _evidence(api: CognifyRecoveryApi, dataset_id: str) -> dict[str, Any]:
    value = api.json(
        "GET",
        f"/api/v1/datasets/{dataset_id}/data?include_cognify_evidence=true",
    )
    if not isinstance(value, dict) or set(value) != {
        "datasetId",
        "inputEvidenceDigest",
        "data",
    }:
        raise AssertionError("Cognify evidence response has an invalid envelope")
    if value["datasetId"] != dataset_id:
        raise AssertionError("Cognify evidence identifies another dataset")
    digest = value["inputEvidenceDigest"]
    rows = value["data"]
    if (
        not isinstance(digest, str)
        or len(digest) != 71
        or not digest.startswith("sha256:")
        or not isinstance(rows, list)
        or not rows
    ):
        raise AssertionError("Cognify evidence is missing its bounded document snapshot")
    document_ids = [row.get("id") for row in rows if isinstance(row, dict)]
    if len(document_ids) != len(rows) or len(set(document_ids)) != len(rows):
        raise AssertionError("Cognify evidence contains malformed or duplicate documents")
    for row in rows:
        if not isinstance(row.get("contentDigest"), str) or not isinstance(
            row.get("byteLength"), int
        ):
            raise AssertionError("Cognify evidence omits safe raw-byte coordinates")
    return value


def _cognify_body(dataset_id: str, operation_id: str, evidence_digest: str) -> dict[str, Any]:
    return {
        "dataset_ids": [dataset_id],
        "run_in_background": False,
        "chunk_size": 128,
        "operation_id": operation_id,
        "expected_input_evidence_digest": evidence_digest,
    }


def _stub_request_count() -> int:
    """Count request metadata; the shared stub log never stores input content."""
    path = Path("/contract-output/stub-requests.jsonl")
    if not path.is_file():
        raise AssertionError("Cognify recovery fixture cannot read the provider request log")
    return sum(1 for line in path.read_text(encoding="utf-8").splitlines() if line)


def _run_id(dataset_id: str, owner_id: str, operation_id: str) -> str:
    from cognee.modules.pipelines.utils import generate_pipeline_id, generate_pipeline_run_id

    dataset_uuid = uuid.UUID(dataset_id)
    pipeline_id = generate_pipeline_id(
        uuid.UUID(owner_id), dataset_uuid, "cognify_pipeline"
    )
    return str(
        generate_pipeline_run_id(
            pipeline_id,
            dataset_uuid,
            operation_id=uuid.UUID(operation_id),
        )
    )


def _require_conflict(api: CognifyRecoveryApi, body: dict[str, Any]) -> None:
    try:
        api.json("POST", "/api/v1/cognify", body, timeout=30)
    except Exception as failure:
        if getattr(failure, "status", None) == 409:
            return
        raise
    raise AssertionError("Stale Cognify input evidence did not conflict")


def _require_recovery(api: CognifyRecoveryApi, body: dict[str, Any]) -> None:
    try:
        api.json("POST", "/api/v1/cognify", body, timeout=30)
    except Exception as failure:
        if getattr(failure, "status", None) == 503:
            return
        raise
    raise AssertionError("Saved Cognify history did not require recovery")


def _terminal(value: Any, dataset_id: str, operation_id: str, evidence_digest: str) -> dict[str, str]:
    if not isinstance(value, dict) or set(value) != {dataset_id}:
        raise AssertionError("Recovered Cognify response does not identify the exact dataset")
    run = value[dataset_id]
    if not isinstance(run, dict) or run.get("status") != "PipelineRunCompleted":
        raise AssertionError("Recovered Cognify response is not a completed run")
    coordinates = {
        "datasetId": str(run.get("dataset_id")),
        "operationId": str(run.get("operation_id")),
        "pipelineRunId": str(run.get("pipeline_run_id")),
        "inputEvidenceDigest": str(run.get("input_evidence_digest")),
    }
    if coordinates["datasetId"] != dataset_id or coordinates["operationId"] != operation_id:
        raise AssertionError("Recovered Cognify response changed command coordinates")
    if coordinates["inputEvidenceDigest"] != evidence_digest:
        raise AssertionError("Recovered Cognify response changed input evidence")
    uuid.UUID(coordinates["pipelineRunId"])
    return coordinates


def _drop_completed_response(
    api: CognifyRecoveryApi,
    drop_proxy: str,
    body: dict[str, Any],
) -> None:
    token = api._access_token
    if not isinstance(token, str) or not token:
        raise AssertionError("Dropped Cognify response requires authentication")
    host, port = drop_proxy.rsplit(":", 1)
    payload = json.dumps(body, separators=(",", ":")).encode()
    connection = http.client.HTTPConnection(host, int(port), timeout=610)
    try:
        connection.request(
            "POST",
            "/api/v1/cognify",
            body=payload,
            headers={
                "accept": "application/json",
                "authorization": f"Bearer {token}",
                "content-length": str(len(payload)),
                "content-type": "application/json",
            },
        )
        response = connection.getresponse()
        response.read()
    except (http.client.RemoteDisconnected, ConnectionResetError):
        return
    finally:
        connection.close()
    raise AssertionError("Commit-then-drop proxy returned the Cognify response")


async def _history_count(pipeline_run_id: str) -> int:
    from sqlalchemy import func, select

    from cognee.infrastructure.databases.relational import get_relational_engine
    from cognee.modules.pipelines.models import PipelineRun

    async with get_relational_engine().get_async_session() as session:
        return int(
            await session.scalar(
                select(func.count()).select_from(PipelineRun).where(
                    PipelineRun.pipeline_run_id == uuid.UUID(pipeline_run_id)
                )
            )
        )


async def _insert_started(
    dataset_id: str,
    owner_id: str,
    operation_id: str,
    evidence_digest: str,
) -> str:
    from cognee.infrastructure.databases.relational import get_relational_engine
    from cognee.modules.pipelines.models import PipelineRun, PipelineRunStatus
    from cognee.modules.pipelines.operations.cognify_input_evidence import (
        build_cognify_request_digest,
    )
    from cognee.modules.pipelines.utils import generate_pipeline_id, generate_pipeline_run_id
    from cognee.modules.users.models import User

    dataset_uuid = uuid.UUID(dataset_id)
    owner_uuid = uuid.UUID(owner_id)
    operation_uuid = uuid.UUID(operation_id)
    pipeline_id = generate_pipeline_id(owner_uuid, dataset_uuid, "cognify_pipeline")
    pipeline_run_id = generate_pipeline_run_id(
        pipeline_id,
        dataset_uuid,
        operation_id=operation_uuid,
    )
    request_digest = build_cognify_request_digest(
        {
            "pipeline": "cognify_pipeline",
            "chunkSize": 128,
            "dataPerBatch": 20,
            "incrementalLoading": True,
            "dataCache": True,
            "graphModel": "KnowledgeGraph",
        }
    )
    async with get_relational_engine().get_async_session() as session:
        user = await session.get(User, owner_uuid)
        if user is None:
            raise AssertionError("Cognify recovery fixture cannot resolve its owner")
        row = PipelineRun(
            pipeline_run_id=pipeline_run_id,
            pipeline_name="cognify_pipeline",
            pipeline_id=pipeline_id,
            status=PipelineRunStatus.DATASET_PROCESSING_STARTED,
            dataset_id=dataset_uuid,
            user_id=owner_uuid,
            tenant_id=getattr(user, "tenant_id", None),
            operation_name="cognify_pipeline",
            run_info={
                "data": [],
                "opencrane_cognify": {
                    "operation_id": operation_id,
                    "request_digest": request_digest,
                    "input_evidence_digest": evidence_digest,
                },
            },
        )
        session.add(row)
        await session.commit()
    return str(pipeline_run_id)


def prepare_cognify_recovery(
    api: CognifyRecoveryApi,
    namespace: str,
    drop_proxy: str,
) -> dict[str, Any]:
    """Create terminal and interrupted histories for restart qualification."""
    dataset = api.create_dataset(_opaque_name(namespace))
    dataset_id = str(dataset.get("id"))
    owner_id = str(dataset.get("ownerId"))
    uuid.UUID(dataset_id)
    uuid.UUID(owner_id)
    api.add(dataset_id, "memory.txt", b"Synthetic Cognify recovery evidence.\n")
    snapshot = _evidence(api, dataset_id)
    operation_id = str(uuid.uuid4())
    body = _cognify_body(dataset_id, operation_id, snapshot["inputEvidenceDigest"])
    _drop_completed_response(api, drop_proxy, body)
    completed_request_count = _stub_request_count()
    terminal = _terminal(
        api.json("POST", "/api/v1/cognify", body, timeout=600),
        dataset_id,
        operation_id,
        snapshot["inputEvidenceDigest"],
    )
    if asyncio.run(_history_count(terminal["pipelineRunId"])) != 2:
        raise AssertionError("Cognify terminal replay appended another run event")
    if _stub_request_count() != completed_request_count:
        raise AssertionError("Cognify terminal replay dispatched provider work")
    changed_evidence_body = _cognify_body(
        dataset_id,
        operation_id,
        "sha256:" + "f" * 64,
    )
    _require_recovery(api, changed_evidence_body)
    if asyncio.run(_history_count(terminal["pipelineRunId"])) != 2:
        raise AssertionError("Mismatched saved Cognify evidence changed run history")
    if _stub_request_count() != completed_request_count:
        raise AssertionError("Mismatched saved Cognify evidence dispatched provider work")

    with ThreadPoolExecutor(max_workers=3) as pool:
        replays = list(
            pool.map(
                lambda _index: _terminal(
                    api.json("POST", "/api/v1/cognify", body, timeout=600),
                    dataset_id,
                    operation_id,
                    snapshot["inputEvidenceDigest"],
                ),
                range(3),
            )
        )
    if any(replay != terminal for replay in replays):
        raise AssertionError("Concurrent Cognify replay changed its terminal receipt")
    if asyncio.run(_history_count(terminal["pipelineRunId"])) != 2:
        raise AssertionError("Concurrent Cognify replay appended another run event")
    if _stub_request_count() != completed_request_count:
        raise AssertionError("Concurrent Cognify replay dispatched provider work")
    print("CASE dropped_and_concurrent_cognify_replay_returns_exact_terminal PASS")

    before_add = _evidence(api, dataset_id)
    added_content = b"Cognify evidence changed after the locked snapshot.\n"
    api.add(dataset_id, "later.txt", added_content)
    after_add = _evidence(api, dataset_id)
    added_digest = f"sha256:{hashlib.sha256(added_content).hexdigest()}"
    added = [
        row
        for row in after_add["data"]
        if isinstance(row, dict) and row.get("contentDigest") == added_digest
    ]
    if len(added) != 1 or not isinstance(added[0].get("id"), str):
        raise AssertionError("Added document is absent from the locked Cognify snapshot")
    add_operation_id = str(uuid.uuid4())
    before_stale_add = _stub_request_count()
    _require_conflict(
        api,
        _cognify_body(dataset_id, add_operation_id, before_add["inputEvidenceDigest"]),
    )
    if asyncio.run(_history_count(_run_id(dataset_id, owner_id, add_operation_id))) != 0:
        raise AssertionError("Stale add snapshot wrote a Cognify run")
    if _stub_request_count() != before_stale_add:
        raise AssertionError("Stale add snapshot dispatched provider work")

    api.delete(dataset_id, added[0]["id"])
    delete_operation_id = str(uuid.uuid4())
    before_stale_delete = _stub_request_count()
    _require_conflict(
        api,
        _cognify_body(
            dataset_id,
            delete_operation_id,
            after_add["inputEvidenceDigest"],
        ),
    )
    if asyncio.run(_history_count(_run_id(dataset_id, owner_id, delete_operation_id))) != 0:
        raise AssertionError("Stale delete snapshot wrote a Cognify run")
    if _stub_request_count() != before_stale_delete:
        raise AssertionError("Stale delete snapshot dispatched provider work")
    print("CASE stale_add_and_delete_snapshots_refuse_cognify_dispatch PASS")

    interrupted_operation_id = str(uuid.uuid4())
    interrupted_run_id = asyncio.run(
        _insert_started(
            dataset_id,
            owner_id,
            interrupted_operation_id,
            snapshot["inputEvidenceDigest"],
        )
    )
    return {
        "datasetId": dataset_id,
        "ownerId": owner_id,
        "operationId": operation_id,
        "pipelineRunId": terminal["pipelineRunId"],
        "inputEvidenceDigest": terminal["inputEvidenceDigest"],
        "interruptedOperationId": interrupted_operation_id,
        "interruptedPipelineRunId": interrupted_run_id,
    }


def verify_cognify_recovery_after_restart(
    api: CognifyRecoveryApi,
    evidence: Any,
) -> dict[str, Any]:
    """Reauthenticate after restart and require terminal replay plus Started refusal."""
    required = {
        "datasetId",
        "ownerId",
        "operationId",
        "pipelineRunId",
        "inputEvidenceDigest",
        "interruptedOperationId",
        "interruptedPipelineRunId",
    }
    if not isinstance(evidence, dict) or set(evidence) != required:
        raise AssertionError("Saved Cognify recovery evidence has an invalid shape")
    for key in (
        "datasetId",
        "ownerId",
        "operationId",
        "pipelineRunId",
        "interruptedOperationId",
        "interruptedPipelineRunId",
    ):
        uuid.UUID(evidence[key])
    request_count = _stub_request_count()
    terminal = _terminal(
        api.json(
            "POST",
            "/api/v1/cognify",
            _cognify_body(
                evidence["datasetId"],
                evidence["operationId"],
                evidence["inputEvidenceDigest"],
            ),
            timeout=600,
        ),
        evidence["datasetId"],
        evidence["operationId"],
        evidence["inputEvidenceDigest"],
    )
    if terminal["pipelineRunId"] != evidence["pipelineRunId"]:
        raise AssertionError("Restart replay changed the completed pipeline run")
    if _stub_request_count() != request_count:
        raise AssertionError("Restart terminal replay dispatched provider work")
    try:
        api.json(
            "POST",
            "/api/v1/cognify",
            _cognify_body(
                evidence["datasetId"],
                evidence["interruptedOperationId"],
                evidence["inputEvidenceDigest"],
            ),
            timeout=30,
        )
    except Exception as failure:
        if getattr(failure, "status", None) != 503:
            raise
    else:
        raise AssertionError("Interrupted Cognify history did not require recovery")
    if asyncio.run(_history_count(evidence["interruptedPipelineRunId"])) != 1:
        raise AssertionError("Interrupted Cognify retry dispatched or appended another event")
    if _stub_request_count() != request_count:
        raise AssertionError("Interrupted Cognify retry dispatched provider work")
    print("CASE cognify_terminal_and_started_histories_survive_restart PASS")
    return evidence
