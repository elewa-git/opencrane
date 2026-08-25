import { describe, expect, it, vi } from "vitest";

import { WorkflowTaskRetryableError, WorkflowTaskStates } from "@opencrane/backend/server/infra/workflows/contract";
import type { IWorkflowTransaction } from "@opencrane/backend/server/infra/workflows/contract";
import { __FakeWorkflowEngine } from "@opencrane/backend/server/infra/workflows/testing";

import type { McpOperatorTransaction, McpOperatorUnitOfWork } from "../core/mcp-operator-repository.types";
import type { McpbValidationRecord } from "../mcpb-validation/mcpb-validation-repository.types";
import { __CreateMcpbValidationWorkflow, __McpbValidationInspectionTaskKey, __McpbValidationTaskKey } from "../mcpb-validation/mcpb-validation";
import { McpbValidationStates, McpbVerificationFailureCodes } from "../mcpb-validation/mcpb-validation.types";
import type { McpbValidationTaskInput, McpbVerificationResult } from "../mcpb-validation/mcpb-validation.types";

/** Mutable product state used by workflow tests. */
interface _ValidationState
{
	/** Current product validation record. */
	validation: McpbValidationRecord;
	/** Number of final audit rows added by the workflow. */
	auditCount: number;
}

/** Return stable task input without placing its identifiers in the task key. */
function _Input(): McpbValidationTaskInput
{
	return { siloId: "silo-private", validationId: "validation-private", artifactId: "artifact-private", artifactRevisionId: "revision-private", contentAddress: `sha256:${"a".repeat(64)}`, byteLength: 128, mediaType: "application/zip", submissionDigest: `sha256:${"b".repeat(64)}` };
}

/** Return one pending product record. */
function _State(): _ValidationState
{
	return { validation: { id: _Input().validationId, siloId: _Input().siloId, artifactId: _Input().artifactId, artifactRevisionId: _Input().artifactRevisionId, contentAddress: _Input().contentAddress, byteLength: _Input().byteLength, mediaType: _Input().mediaType, submissionDigest: _Input().submissionDigest, state: McpbValidationStates.Pending, manifestName: null, bundleVersion: null, manifestDigest: null, publisher: null, signerFingerprint: null, failureCode: null }, auditCount: 0 };
}

/** Apply one verifier answer to the mutable product record. */
function _Store(state: _ValidationState, result: McpbVerificationResult): void
{
	state.validation = result.accepted
		? { ...state.validation, state: McpbValidationStates.Verified, manifestName: result.manifest.name, bundleVersion: result.manifest.version, manifestDigest: result.manifest.manifestDigest, publisher: result.manifest.publisher, signerFingerprint: result.manifest.signerFingerprint, failureCode: null }
		: { ...state.validation, state: McpbValidationStates.Rejected, manifestName: null, bundleVersion: null, manifestDigest: null, publisher: null, signerFingerprint: null, failureCode: result.failureCode };
}

/** Provide only the transaction ports used by the MCP bundle workflow. */
function _UnitOfWork(state: _ValidationState): McpOperatorUnitOfWork
{
	const mcpbValidations = {
		load: vi.fn().mockImplementation(function _Load(): Promise<McpbValidationRecord> { return Promise.resolve({ ...state.validation }); }),
		recordResult: vi.fn().mockImplementation(function _Record(_siloId: string, _validationId: string, _submissionDigest: string, result: McpbVerificationResult)
		{
			const changed = state.validation.state === McpbValidationStates.Pending;
			if (changed)
				_Store(state, result);
			return Promise.resolve({ changed, validation: { ...state.validation } });
		}),
	};
	const mcp = { appendAudit: vi.fn().mockImplementation(function _Audit(): Promise<void> { state.auditCount += 1; return Promise.resolve(); }) };
	const transaction = { mcp, mcpbValidations, workflowTransaction: _Transaction() } as unknown as McpOperatorTransaction;
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
	await execution.startWorkers({ workerName: "mcpb-validation-test" });
}

describe("MCP bundle validation workflow", function _McpbValidationSuite()
{
	it("stores trusted manifest and signature evidence", async function _StoresVerifiedResult()
	{
		const state = _State();
		const execution = new __FakeWorkflowEngine();
		const result: McpbVerificationResult = { accepted: true, manifest: { manifestVersion: "0.3", manifestDigest: `sha256:${"c".repeat(64)}`, name: "example-server", version: "1.2.3", publisher: "Example Publisher", signerFingerprint: `sha256:${"d".repeat(64)}` } };
		const verifier = { verify: vi.fn().mockResolvedValue(result) };
		const workflow = __CreateMcpbValidationWorkflow({ execution, verifier, unitOfWork: _UnitOfWork(state) });
		const admitted = await workflow.admit(_Transaction(), _Input());

		await _Drain(execution);

		expect(execution.taskSnapshot(admitted.receipt)).toMatchObject({ state: WorkflowTaskStates.Completed, result });
		expect(state.validation).toMatchObject({ state: McpbValidationStates.Verified, manifestName: "example-server", publisher: "Example Publisher" });
		expect(state.auditCount).toBe(1);
		expect(verifier.verify).toHaveBeenCalledWith(expect.objectContaining({ validationId: "validation-private", artifactRevisionId: "revision-private" }));
	});

	it("stores one bounded rejection reason", async function _StoresRejectedResult()
	{
		const state = _State();
		const execution = new __FakeWorkflowEngine();
		const result: McpbVerificationResult = { accepted: false, failureCode: McpbVerificationFailureCodes.InvalidSignature };
		const workflow = __CreateMcpbValidationWorkflow({ execution, verifier: { verify: vi.fn().mockResolvedValue(result) }, unitOfWork: _UnitOfWork(state) });
		const admitted = await workflow.admit(_Transaction(), _Input());

		await _Drain(execution);

		expect(execution.taskSnapshot(admitted.receipt)).toMatchObject({ state: WorkflowTaskStates.Completed, result });
		expect(state.validation).toMatchObject({ state: McpbValidationStates.Rejected, failureCode: McpbVerificationFailureCodes.InvalidSignature });
	});

	it("returns a stored final answer without reading bundle bytes again", async function _ReplaysStoredResult()
	{
		const state = _State();
		_Store(state, { accepted: false, failureCode: McpbVerificationFailureCodes.InvalidManifest });
		const execution = new __FakeWorkflowEngine();
		const verify = vi.fn();
		const workflow = __CreateMcpbValidationWorkflow({ execution, verifier: { verify }, unitOfWork: _UnitOfWork(state) });
		const admitted = await workflow.admit(_Transaction(), _Input());

		await _Drain(execution);

		expect(execution.taskSnapshot(admitted.receipt)).toMatchObject({ state: WorkflowTaskStates.Completed, result: { accepted: false, failureCode: McpbVerificationFailureCodes.InvalidManifest } });
		expect(verify).not.toHaveBeenCalled();
	});

	it("keeps a temporary verifier outage retryable", async function _KeepsVerifierOutageRetryable()
	{
		const execution = new __FakeWorkflowEngine();
		const workflow = __CreateMcpbValidationWorkflow({ execution, verifier: { verify: vi.fn().mockRejectedValue(new Error("offline")) }, unitOfWork: _UnitOfWork(_State()) });
		const admitted = await workflow.admit(_Transaction(), _Input());

		await _Drain(execution);

		expect(execution.taskSnapshot(admitted.receipt)).toMatchObject({ state: WorkflowTaskStates.Failed, error: expect.any(WorkflowTaskRetryableError) });
	});

	it("uses the same opaque key for repeated admission", function _UsesStableOpaqueTaskKey()
	{
		const taskKey = __McpbValidationTaskKey(_Input());
		const inspectionTaskKey = __McpbValidationInspectionTaskKey(_Input());

		expect(taskKey).toBe(__McpbValidationTaskKey(_Input()));
		expect(inspectionTaskKey).toBe(__McpbValidationInspectionTaskKey(_Input()));
		expect(inspectionTaskKey).not.toBe(taskKey);
		expect(taskKey).not.toContain(_Input().siloId);
		expect(taskKey).not.toContain(_Input().validationId);
		expect(taskKey).not.toContain(_Input().artifactRevisionId);
		expect(inspectionTaskKey).not.toContain(_Input().validationId);
	});
});
