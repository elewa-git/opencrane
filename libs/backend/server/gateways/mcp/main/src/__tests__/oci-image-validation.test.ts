import { describe, expect, it, vi } from "vitest";

import { WorkflowTaskRetryableError, WorkflowTaskStates } from "@opencrane/backend/server/infra/workflows/contract";
import type { IWorkflowTransaction } from "@opencrane/backend/server/infra/workflows/contract";
import { __FakeWorkflowEngine } from "@opencrane/backend/server/infra/workflows/testing";

import type { McpOperatorTransaction, McpOperatorUnitOfWork } from "../core/mcp-operator-repository.types";
import type { OciImageValidationRecord } from "../oci-image-validation/oci-image-validation-repository.types";
import { OciImageImportFailure } from "../oci-image-validation/oci-image-import-failure";
import { __CreateOciImageValidationWorkflow, __OciImageValidationTaskKey } from "../oci-image-validation/oci-image-validation";
import { OciImageValidationStates, OciImageVerificationFailureCodes } from "../oci-image-validation/oci-image-validation.types";
import type { OciImageAdmissionResult, OciImageValidationTaskInput } from "../oci-image-validation/oci-image-validation.types";

/** Mutable product state used by workflow tests. */
interface _ValidationState
{
	/** Current product admission record. */
	validation: OciImageValidationRecord;
	/** Number of final audit rows added by the workflow. */
	auditCount: number;
}

/** Return stable task input without placing its identifiers in the task key. */
function _Input(): OciImageValidationTaskInput
{
	return { siloId: "silo-private", validationId: "validation-private", artifactId: "artifact-private", artifactRevisionId: "revision-private", contentAddress: `sha256:${"a".repeat(64)}`, byteLength: 128, mediaType: "application/vnd.oci.image.layout.v1+zip", submissionDigest: `sha256:${"b".repeat(64)}` };
}

/** Return one pending product record. */
function _State(): _ValidationState
{
	return { validation: { id: _Input().validationId, siloId: _Input().siloId, artifactId: _Input().artifactId, artifactRevisionId: _Input().artifactRevisionId, contentAddress: _Input().contentAddress, byteLength: _Input().byteLength, mediaType: _Input().mediaType, submissionDigest: _Input().submissionDigest, state: OciImageValidationStates.Pending, indexDigest: null, imageManifestDigest: null, configDigest: null, registryReference: null, failureCode: null }, auditCount: 0 };
}

/** Apply one admission answer to the mutable product record. */
function _Store(state: _ValidationState, result: OciImageAdmissionResult): void
{
	state.validation = result.accepted
		? { ...state.validation, state: OciImageValidationStates.Imported, indexDigest: result.layout.indexDigest, imageManifestDigest: result.layout.imageManifestDigest, configDigest: result.layout.configDigest, registryReference: result.layout.registryReference, failureCode: null }
		: { ...state.validation, state: OciImageValidationStates.Rejected, indexDigest: null, imageManifestDigest: null, configDigest: null, registryReference: null, failureCode: result.failureCode };
}

/** Provide only the transaction ports used by the OCI image workflow. */
function _UnitOfWork(state: _ValidationState): McpOperatorUnitOfWork
{
	const ociImageValidations = {
		load: vi.fn().mockImplementation(function _Load(): Promise<OciImageValidationRecord> { return Promise.resolve({ ...state.validation }); }),
		recordResult: vi.fn().mockImplementation(function _Record(_siloId: string, _validationId: string, _submissionDigest: string, result: OciImageAdmissionResult)
		{
			const changed = state.validation.state === OciImageValidationStates.Pending;
			if (changed)
				_Store(state, result);
			return Promise.resolve({ changed, validation: { ...state.validation } });
		}),
	};
	const mcp = { appendAudit: vi.fn().mockImplementation(function _Audit(): Promise<void> { state.auditCount += 1; return Promise.resolve(); }) };
	const transaction = { mcp, ociImageValidations, workflowTransaction: _Transaction() } as unknown as McpOperatorTransaction;
	return { execute: async function _Execute<Result>(operation: (value: McpOperatorTransaction) => Promise<Result>): Promise<Result> { return await operation(transaction); } };
}

/** Return an opaque database transaction for fake task admission. */
function _Transaction(): IWorkflowTransaction
{
	return { client: {} };
}

/** Start fake workers after admitting one task. */
async function _Drain(execution: __FakeWorkflowEngine): Promise<void>
{
	await execution.startWorkers({ workerName: "oci-image-admission-test" });
}

describe("OCI image admission workflow", function _OciImageAdmissionSuite()
{
	it("stores an immutable registry reference only after validation and import", async function _StoresImportedResult()
	{
		const state = _State();
		const execution = new __FakeWorkflowEngine();
		const validated = { indexDigest: `sha256:${"c".repeat(64)}`, imageManifestDigest: `sha256:${"d".repeat(64)}`, configDigest: `sha256:${"e".repeat(64)}` };
		const imported = { ...validated, registryReference: `registry.example.test/opencrane/mcp@${validated.imageManifestDigest}` };
		const workflow = __CreateOciImageValidationWorkflow({ execution, verifier: { verify: vi.fn().mockResolvedValue({ accepted: true, layout: validated }) }, importer: { import: vi.fn().mockResolvedValue(imported) }, unitOfWork: _UnitOfWork(state) });
		const admitted = await workflow.admit(_Transaction(), _Input());

		await _Drain(execution);

		expect(execution.taskSnapshot(admitted.receipt)).toMatchObject({ state: WorkflowTaskStates.Completed, result: { accepted: true, layout: imported } });
		expect(state.validation).toMatchObject({ state: OciImageValidationStates.Imported, registryReference: imported.registryReference });
		expect(state.auditCount).toBe(1);
	});

	it("does not call the registry when layout validation rejects the upload", async function _StoresRejectedResult()
	{
		const state = _State();
		const execution = new __FakeWorkflowEngine();
		const importer = { import: vi.fn() };
		const result = { accepted: false as const, failureCode: OciImageVerificationFailureCodes.InvalidImageManifest };
		const workflow = __CreateOciImageValidationWorkflow({ execution, verifier: { verify: vi.fn().mockResolvedValue(result) }, importer, unitOfWork: _UnitOfWork(state) });
		const admitted = await workflow.admit(_Transaction(), _Input());

		await _Drain(execution);

		expect(execution.taskSnapshot(admitted.receipt)).toMatchObject({ state: WorkflowTaskStates.Completed, result });
		expect(importer.import).not.toHaveBeenCalled();
		expect(state.validation).toMatchObject({ state: OciImageValidationStates.Rejected, failureCode: OciImageVerificationFailureCodes.InvalidImageManifest });
	});

	it("keeps a temporary registry outage retryable", async function _KeepsRegistryOutageRetryable()
	{
		const execution = new __FakeWorkflowEngine();
		const validated = { indexDigest: `sha256:${"c".repeat(64)}`, imageManifestDigest: `sha256:${"d".repeat(64)}`, configDigest: `sha256:${"e".repeat(64)}` };
		const workflow = __CreateOciImageValidationWorkflow({ execution, verifier: { verify: vi.fn().mockResolvedValue({ accepted: true, layout: validated }) }, importer: { import: vi.fn().mockRejectedValue(new OciImageImportFailure("offline", true)) }, unitOfWork: _UnitOfWork(_State()) });
		const admitted = await workflow.admit(_Transaction(), _Input());

		await _Drain(execution);

		expect(execution.taskSnapshot(admitted.receipt)).toMatchObject({ state: WorkflowTaskStates.Failed, error: expect.any(WorkflowTaskRetryableError) });
	});

	it("stores a rejection when validation remains unavailable on the final attempt", async function _StoresFinalValidationFailure()
	{
		const state = _State();
		const execution = new __FakeWorkflowEngine();
		const importer = { import: vi.fn() };
		const workflow = __CreateOciImageValidationWorkflow({ execution, verifier: { verify: vi.fn().mockRejectedValue(new Error("offline")) }, importer, unitOfWork: _UnitOfWork(state) });
		const admitted = await workflow.admit(_Transaction(), _Input());
		execution.setTaskAttempt(admitted.receipt, 5);

		await _Drain(execution);

		expect(execution.taskSnapshot(admitted.receipt)).toMatchObject({ state: WorkflowTaskStates.Completed, result: { accepted: false, failureCode: OciImageVerificationFailureCodes.ValidationFailed } });
		expect(state.validation).toMatchObject({ state: OciImageValidationStates.Rejected, failureCode: OciImageVerificationFailureCodes.ValidationFailed });
		expect(importer.import).not.toHaveBeenCalled();
	});

	it("returns a stored import without reading artifact bytes again", async function _ReplaysStoredResult()
	{
		const state = _State();
		const result: OciImageAdmissionResult = { accepted: true, layout: { indexDigest: `sha256:${"c".repeat(64)}`, imageManifestDigest: `sha256:${"d".repeat(64)}`, configDigest: `sha256:${"e".repeat(64)}`, registryReference: `registry.example.test/opencrane/mcp@sha256:${"d".repeat(64)}` } };
		_Store(state, result);
		const execution = new __FakeWorkflowEngine();
		const verify = vi.fn();
		const importer = { import: vi.fn() };
		const workflow = __CreateOciImageValidationWorkflow({ execution, verifier: { verify }, importer, unitOfWork: _UnitOfWork(state) });
		const admitted = await workflow.admit(_Transaction(), _Input());

		await _Drain(execution);

		expect(execution.taskSnapshot(admitted.receipt)).toMatchObject({ state: WorkflowTaskStates.Completed, result });
		expect(verify).not.toHaveBeenCalled();
		expect(importer.import).not.toHaveBeenCalled();
	});

	it("uses the same opaque key for repeated admission", function _UsesStableOpaqueTaskKey()
	{
		const taskKey = __OciImageValidationTaskKey(_Input());

		expect(taskKey).toBe(__OciImageValidationTaskKey(_Input()));
		expect(taskKey).not.toContain(_Input().siloId);
		expect(taskKey).not.toContain(_Input().validationId);
	});
});
