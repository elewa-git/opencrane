import { describe, expect, it, vi } from "vitest";

import type { IWorkflowTransaction } from "@opencrane/backend/server/infra/workflows/contract";

import type { McpOperatorTransaction, McpOperatorUnitOfWork } from "../core/mcp-operator-repository.types";
import type { OciImageValidationRecord, OciImageValidationSubmissionRecord } from "../oci-image-validation/oci-image-validation-repository.types";
import { submitOciImageValidation } from "../oci-image-validation/oci-image-validation-submission";
import { OciImageValidationSubmissionOutcomes } from "../oci-image-validation/oci-image-validation-submission.types";
import type { OciImageLayoutArtifactResolver, OciImageValidationSubmissionCommand } from "../oci-image-validation/oci-image-validation-submission.types";
import { OciImageValidationStates } from "../oci-image-validation/oci-image-validation.types";
import type { OciImageValidationWorkflow } from "../oci-image-validation/oci-image-validation.types";

/** Stateful dependencies used to prove one submission's transaction boundaries. */
interface _SubmissionHarness
{
	/** Unit of work that exposes the same fake transaction to every operation. */
	readonly unitOfWork: McpOperatorUnitOfWork;
	/** Workflow mock that records the transaction and immutable task input. */
	readonly workflow: OciImageValidationWorkflow;
	/** Artifact resolver constrained by the authenticated silo argument. */
	readonly artifacts: OciImageLayoutArtifactResolver;
	/** Exact workflow transaction owned by the fake database transaction. */
	readonly workflowTransaction: IWorkflowTransaction;
	/** Transaction entry spy used to prove rejected artifacts start no database work. */
	readonly execute: ReturnType<typeof vi.fn>;
	/** Task-admission spy used to compare repeated immutable input. */
	readonly admit: ReturnType<typeof vi.fn>;
	/** Audit spy used to prove a replay does not announce another creation. */
	readonly audit: ReturnType<typeof vi.fn>;
}

/** Return one valid administrator submission command. */
function _Command(): OciImageValidationSubmissionCommand
{
	return { idempotencyKey: "oci-layout-upload-1", artifactId: "artifact-1", artifactRevisionId: "revision-1" };
}

/** Map one trusted submission record to its pending product row. */
function _Validation(submission: OciImageValidationSubmissionRecord): OciImageValidationRecord
{
	return { id: "validation-1", siloId: submission.siloId, artifactId: submission.artifactId, artifactRevisionId: submission.artifactRevisionId, contentAddress: submission.contentAddress, byteLength: submission.byteLength, mediaType: submission.mediaType, submissionDigest: submission.submissionDigest, state: OciImageValidationStates.Pending, indexDigest: null, imageManifestDigest: null, configDigest: null, registryReference: null, failureCode: null };
}

/** Build a transaction-backed submission harness with one idempotency-key winner. */
function _Harness(): _SubmissionHarness
{
	let stored: OciImageValidationRecord | null = null;
	const audit = vi.fn().mockResolvedValue(undefined);
	const createOrFind = vi.fn().mockImplementation(function _CreateOrFind(submission: OciImageValidationSubmissionRecord)
	{
		if (stored !== null)
			return Promise.resolve({ created: false, validation: stored });
		stored = _Validation(submission);
		return Promise.resolve({ created: true, validation: stored });
	});
	const workflowTransaction: IWorkflowTransaction = { client: { transaction: "same-database-transaction" } };
	const authorization = {
		listPrincipalEntitled: vi.fn().mockImplementation(function _Allow(command: { resources: readonly unknown[] }) { return Promise.resolve(command.resources); }),
		admitPrincipal: vi.fn().mockResolvedValue({ outcome: "allow", reason: "winning_allow", grantIds: ["grant-1"], evidence: { decisionDigest: `sha256:${"a".repeat(64)}`, policyRevisionHash: `sha256:${"b".repeat(64)}`, effectiveAuthorizationDigest: `sha256:${"c".repeat(64)}` } }),
	};
	const transaction = { ociImageValidations: { createOrFind }, mcp: { appendAudit: audit }, authorization, workflowTransaction } as unknown as McpOperatorTransaction;
	const execute = vi.fn().mockImplementation(async function _Execute<Result>(operation: (value: McpOperatorTransaction) => Promise<Result>): Promise<Result> { return await operation(transaction); });
	const admit = vi.fn().mockResolvedValue({ taskKey: "workflows:oci-image-validation:test", receipt: { taskId: "task-1", taskName: "oci-image-validation.import", idempotencyKey: "workflows:oci-image-validation:test" } });
	const artifacts = { resolve: vi.fn().mockImplementation(function _Resolve(siloId: string, artifactId: string, artifactRevisionId: string)
	{
		if (siloId !== "silo-1")
			return Promise.resolve(null);
		return Promise.resolve({ siloId, artifactId, artifactRevisionId, contentAddress: `sha256:${"a".repeat(64)}`, byteLength: 4_096, mediaType: "application/vnd.oci.image.layout.v1+zip" });
	}) };
	return { unitOfWork: { execute }, workflow: { admit }, artifacts, workflowTransaction, execute, admit, audit };
}

describe("OCI image validation submission", function _OciImageValidationSubmissionSuite()
{
	it("returns the same validation and task input when the same request is retried", async function _ReplaysIdempotently()
	{
		const harness = _Harness();
		const caller = { siloId: "silo-1", principalId: "admin-1" };

		const first = await submitOciImageValidation(harness.unitOfWork, harness.workflow, harness.artifacts, caller, _Command());
		const retried = await submitOciImageValidation(harness.unitOfWork, harness.workflow, harness.artifacts, caller, _Command());

		expect(first).toEqual(retried);
		expect(first.outcome).toBe(OciImageValidationSubmissionOutcomes.Submitted);
		expect(harness.audit).toHaveBeenCalledTimes(1);
		expect(harness.admit).toHaveBeenCalledTimes(2);
		expect(harness.admit.mock.calls[0][0]).toBe(harness.workflowTransaction);
		expect(harness.admit.mock.calls[0][1]).toEqual(harness.admit.mock.calls[1][1]);
	});

	it("returns a conflict without admitting changed input under the same key", async function _RejectsChangedReplay()
	{
		const harness = _Harness();
		const caller = { siloId: "silo-1", principalId: "admin-1" };

		await submitOciImageValidation(harness.unitOfWork, harness.workflow, harness.artifacts, caller, _Command());
		const changed = await submitOciImageValidation(harness.unitOfWork, harness.workflow, harness.artifacts, caller, { ..._Command(), artifactRevisionId: "revision-2" });

		expect(changed.outcome).toBe(OciImageValidationSubmissionOutcomes.Conflict);
		expect(harness.admit).toHaveBeenCalledTimes(1);
	});

	it("authorizes then resolves through the authenticated silo when the artifact is unavailable", async function _KeepsArtifactLookupInsideSilo()
	{
		const harness = _Harness();

		const result = await submitOciImageValidation(harness.unitOfWork, harness.workflow, harness.artifacts, { siloId: "silo-2", principalId: "admin-2" }, _Command());

		expect(result.outcome).toBe(OciImageValidationSubmissionOutcomes.ArtifactNotFound);
		expect(harness.artifacts.resolve).toHaveBeenCalledWith("silo-2", "artifact-1", "revision-1");
		expect(harness.execute).toHaveBeenCalledOnce();
		expect(harness.admit).not.toHaveBeenCalled();
	});
});
