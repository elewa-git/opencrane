#!/usr/bin/env python3
"""Verify the candidate Cognify evidence and exact-run recovery helpers."""

import asyncio
import hashlib
import importlib.util
import sys
import types
import unittest
from enum import Enum
from pathlib import Path
from types import SimpleNamespace
from uuid import UUID, uuid4, uuid5


REPOSITORY_ROOT = Path(__file__).resolve().parents[5]
PATCH_DIRECTORY = REPOSITORY_ROOT / "apps/_infra/cognee/tests/candidates/1.5.4/patches"
APPLIER_PATH = PATCH_DIRECTORY / "apply-source-patch.py"
APPLIER_SPEC = importlib.util.spec_from_file_location("candidate_source_patch", APPLIER_PATH)
if APPLIER_SPEC is None or APPLIER_SPEC.loader is None:
    raise RuntimeError("Unable to load the candidate source patch helper")
APPLIER = importlib.util.module_from_spec(APPLIER_SPEC)
APPLIER_SPEC.loader.exec_module(APPLIER)


def _new_module_source(patch_name: str) -> str:
    patch = (PATCH_DIRECTORY / patch_name).read_text(encoding="utf-8")
    return APPLIER._apply_unified_patch("", patch)


def _load_evidence_module() -> types.ModuleType:
    source = _new_module_source("cognify-input-evidence.patch").replace(
        "from cognee.infrastructure.files.utils.open_data_file import open_data_file",
        "open_data_file = None",
    )
    module = types.ModuleType("candidate_cognify_input_evidence")
    exec(compile(source, "cognify_input_evidence.py", "exec"), module.__dict__)
    return module


class _Status(Enum):
    DATASET_PROCESSING_STARTED = "started"
    DATASET_PROCESSING_COMPLETED = "completed"
    DATASET_PROCESSING_ERRORED = "errored"
    UNKNOWN = "unknown"


class _RunInfo:
    def __init__(self, **values):
        self.__dict__.update(values)


class _PipelineRun:
    pass


def _load_recovery_module(evidence_module: types.ModuleType) -> types.ModuleType:
    source = _new_module_source("cognify-run-recovery.patch")
    source = source.replace("from sqlalchemy import select", "select = None")
    source = source.replace(
        "from cognee.infrastructure.databases.relational import get_relational_engine",
        "get_relational_engine = None",
    )
    source = source.replace(
        "from cognee.modules.pipelines.models import PipelineRun, PipelineRunStatus",
        "PipelineRun = _PipelineRun\nPipelineRunStatus = _Status",
    )
    source = source.replace(
        "from cognee.modules.pipelines.models.PipelineRunInfo import "
        "PipelineRunCompleted, PipelineRunErrored",
        "PipelineRunCompleted = _RunInfo\nPipelineRunErrored = _RunInfo",
    )
    source = source.replace(
        "from cognee.modules.pipelines.utils import generate_pipeline_run_id",
        "generate_pipeline_run_id = _generate_pipeline_run_id",
    )
    source = source.replace(
        "from .cognify_input_evidence import build_cognify_input_evidence",
        "build_cognify_input_evidence = _build_cognify_input_evidence",
    )
    name = "candidate_cognify_run_recovery"
    module = types.ModuleType(name)
    module.__dict__.update(
        {
            "_PipelineRun": _PipelineRun,
            "_Status": _Status,
            "_RunInfo": _RunInfo,
            "_generate_pipeline_run_id": lambda pipeline_id, dataset_id, operation_id: uuid5(
                pipeline_id, str(operation_id)
            ),
            "_build_cognify_input_evidence": evidence_module.build_cognify_input_evidence,
        }
    )
    sys.modules[name] = module
    exec(compile(source, "cognify_run_recovery.py", "exec"), module.__dict__)
    return module


def _row(dataset_id: UUID, owner_id: UUID, *, content: bytes = b"fact") -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid4(),
        dataset_id=dataset_id,
        owner_id=owner_id,
        tenant_id=None,
        raw_data_location="ignored",
        name="fact.txt",
        label=None,
        extension=".txt",
        original_extension=".txt",
        mime_type="text/plain",
        original_mime_type="text/plain",
        loader_engine="text",
        content_hash=hashlib.sha256(content).hexdigest(),
        raw_content_hash=hashlib.sha256(content).hexdigest(),
        external_metadata={"source": "test"},
        system_metadata={"route": "standard"},
        node_set=["memory"],
        importance_weight=1.0,
        pipeline_status={"cognify_pipeline": "DATASET_PROCESSING_INITIATED"},
        content=content,
    )


async def _raw(row_by_location: dict[str, bytes], location: str) -> bytes:
    return row_by_location[location]


class CandidateCognifyRecovery154Test(unittest.TestCase):
    def setUp(self) -> None:
        self.evidence = _load_evidence_module()
        self.recovery = _load_recovery_module(self.evidence)
        self.user = SimpleNamespace(id=uuid4(), tenant_id=None)
        self.dataset = SimpleNamespace(id=uuid4(), owner_id=self.user.id, name="opaque")

    def _evidence(self, rows: list[SimpleNamespace]):
        locations = {}
        for index, row in enumerate(rows):
            row.raw_data_location = f"raw-{index}"
            locations[row.raw_data_location] = row.content

        async def read(location: str) -> bytes:
            return await _raw(locations, location)

        return asyncio.run(
            self.evidence.build_cognify_input_evidence(self.dataset, self.user, rows, read)
        )

    def test_snapshot_is_order_independent_and_changes_with_effect_input(self) -> None:
        first = _row(self.dataset.id, self.user.id, content=b"alpha")
        second = _row(self.dataset.id, self.user.id, content=b"beta")
        digest, projected = self._evidence([first, second])
        reverse, reverse_projected = self._evidence([second, first])
        self.assertEqual(reverse, digest)
        self.assertEqual(reverse_projected, projected)
        second.pipeline_status["cognify_pipeline"] = "DATASET_PROCESSING_COMPLETED"
        changed, _ = self._evidence([first, second])
        self.assertNotEqual(changed, digest)
        second.content = b"changed"
        changed_bytes, _ = self._evidence([first, second])
        self.assertNotEqual(changed_bytes, changed)

    def test_snapshot_rejects_foreign_duplicate_and_oversized_data(self) -> None:
        row = _row(self.dataset.id, self.user.id)
        foreign = _row(uuid4(), self.user.id)
        with self.assertRaisesRegex(ValueError, "foreign"):
            self._evidence([foreign])
        duplicate = _row(self.dataset.id, self.user.id)
        duplicate.id = row.id
        with self.assertRaisesRegex(ValueError, "duplicate"):
            self._evidence([row, duplicate])
        row.content = b"x" * (self.evidence.MAXIMUM_DOCUMENT_BYTES + 1)
        with self.assertRaisesRegex(ValueError, "byte limit"):
            self._evidence([row])
        self.dataset.owner_id = uuid4()
        with self.assertRaises(PermissionError):
            self._evidence([])

    def _history_row(self, status: _Status, operation_id: UUID, request: str, evidence: str):
        return SimpleNamespace(
            pipeline_id=self.pipeline_id,
            pipeline_name="cognify_pipeline",
            operation_name="cognify_pipeline",
            dataset_id=self.dataset.id,
            user_id=self.user.id,
            tenant_id=None,
            status=status,
            run_info={
                "opencrane_cognify": {
                    "operation_id": str(operation_id),
                    "request_digest": request,
                    "input_evidence_digest": evidence,
                }
            },
            error_class="SyntheticError",
            error_message="Synthetic failure",
        )

    def test_terminal_history_replays_exact_receipt(self) -> None:
        self.pipeline_id = uuid4()
        operation = uuid4()
        request = "sha256:" + "1" * 64
        evidence = "sha256:" + "2" * 64
        run_id = uuid5(self.pipeline_id, str(operation))
        started = self._history_row(_Status.DATASET_PROCESSING_STARTED, operation, request, evidence)
        completed = self._history_row(_Status.DATASET_PROCESSING_COMPLETED, operation, request, evidence)
        replay = self.recovery._plan_saved_history(
            [started, completed], self.pipeline_id, "cognify_pipeline", self.dataset,
            self.user, operation, request, evidence, run_id,
        )
        self.assertEqual(replay.run_info.pipeline_run_id, run_id)
        self.assertEqual(replay.run_info.operation_id, operation)
        self.assertEqual(replay.run_info.input_evidence_digest, evidence)
        errored = self._history_row(
            _Status.DATASET_PROCESSING_ERRORED, operation, request, evidence
        )
        failed = self.recovery._plan_saved_history(
            [started, errored], self.pipeline_id, "cognify_pipeline", self.dataset,
            self.user, operation, request, evidence, run_id,
        )
        self.assertEqual(failed.run_info.error_class, "SyntheticError")
        self.assertEqual(failed.run_info.payload, "Saved Cognify run errored")

    def test_started_and_contradictory_history_require_recovery(self) -> None:
        self.pipeline_id = uuid4()
        operation = uuid4()
        request = "sha256:" + "3" * 64
        evidence = "sha256:" + "4" * 64
        run_id = uuid5(self.pipeline_id, str(operation))
        started = self._history_row(_Status.DATASET_PROCESSING_STARTED, operation, request, evidence)
        with self.assertRaises(self.recovery.CognifyRecoveryRequiredError):
            self.recovery._plan_saved_history(
                [started], self.pipeline_id, "cognify_pipeline", self.dataset,
                self.user, operation, request, evidence, run_id,
            )
        terminal = self._history_row(_Status.DATASET_PROCESSING_COMPLETED, operation, request, evidence)
        with self.assertRaises(self.recovery.CognifyRecoveryRequiredError):
            self.recovery._plan_saved_history(
                [started, terminal, terminal], self.pipeline_id, "cognify_pipeline", self.dataset,
                self.user, operation, request, evidence, run_id,
            )
        with self.assertRaises(self.recovery.CognifyRecoveryRequiredError):
            self.recovery._plan_saved_history(
                [terminal, started], self.pipeline_id, "cognify_pipeline", self.dataset,
                self.user, operation, request, evidence, run_id,
            )

    def test_saved_coordinate_or_digest_mismatch_fails_closed(self) -> None:
        self.pipeline_id = uuid4()
        operation = uuid4()
        request = "sha256:" + "5" * 64
        evidence = "sha256:" + "6" * 64
        run_id = uuid5(self.pipeline_id, str(operation))
        started = self._history_row(_Status.DATASET_PROCESSING_STARTED, operation, request, evidence)
        started.dataset_id = uuid4()
        with self.assertRaises(self.recovery.CognifyRecoveryRequiredError):
            self.recovery._plan_saved_history(
                [started], self.pipeline_id, "cognify_pipeline", self.dataset,
                self.user, operation, request, evidence, run_id,
            )
        started.dataset_id = self.dataset.id
        with self.assertRaises(self.recovery.CognifyRecoveryRequiredError):
            self.recovery._plan_saved_history(
                [started], self.pipeline_id, "cognify_pipeline", self.dataset,
                self.user, operation, request, "sha256:" + "7" * 64, run_id,
            )
        terminal = self._history_row(
            _Status.DATASET_PROCESSING_COMPLETED,
            operation,
            "sha256:" + "8" * 64,
            evidence,
        )
        with self.assertRaises(self.recovery.CognifyRecoveryRequiredError):
            self.recovery._plan_saved_history(
                [started, terminal], self.pipeline_id, "cognify_pipeline", self.dataset,
                self.user, operation, request, evidence, run_id,
            )
        coherent_terminal = self._history_row(
            _Status.DATASET_PROCESSING_COMPLETED, operation, request, evidence
        )
        with self.assertRaises(self.recovery.CognifyRecoveryRequiredError):
            self.recovery._plan_saved_history(
                [started, coherent_terminal], self.pipeline_id, "cognify_pipeline", self.dataset,
                self.user, operation, request, "sha256:" + "9" * 64, run_id,
            )
        started.run_info = {}
        with self.assertRaises(self.recovery.CognifyRecoveryRequiredError):
            self.recovery._plan_saved_history(
                [started], self.pipeline_id, "cognify_pipeline", self.dataset,
                self.user, operation, request, evidence, run_id,
            )


if __name__ == "__main__":
    unittest.main()
