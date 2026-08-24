import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { McpOperatorCaller } from "../core/mcp-operator.logic.types";
import type { McpOperatorTransaction, McpOperatorUnitOfWork } from "../core/mcp-operator-repository.types";
import { getMcpbValidation, submitMcpbValidation } from "../mcpb-validation/mcpb-validation-submission";
import { McpbValidationSubmissionOutcomes } from "../mcpb-validation/mcpb-validation-submission.types";
import type { McpbBundleArtifactResolver } from "../mcpb-validation/mcpb-validation-submission.types";
import { MCPB_MANIFEST_VERSION, MCPB_MAXIMUM_BUNDLE_BYTES, McpbValidationStates } from "../mcpb-validation/mcpb-validation.types";
import type { McpbValidationWorkflow } from "../mcpb-validation/mcpb-validation.types";
import type { McpbValidationRecord } from "../mcpb-validation/mcpb-validation-repository.types";

/** Return the authenticated administrator who owns every submission in this suite. */
function _Caller(): McpOperatorCaller
{
	return { siloId: "silo-1", principalId: "principal-1" };
}

/** Return exact immutable artifact facts that the caller is allowed to submit. */
function _Target(byteLength = 1_024)
{
	return { siloId: "silo-1", artifactId: "artifact-1", artifactRevisionId: "revision-1", contentAddress: `sha256:${"a".repeat(64)}`, byteLength, mediaType: "application/zip" };
}

/** Return the stored validation selected or created by the submission transaction. */
function _Record(byteLength = 1_024): McpbValidationRecord
{
	const target = _Target(byteLength);
	const submissionDigest = `sha256:${createHash("sha256").update(JSON.stringify([target.artifactId, target.artifactRevisionId, target.contentAddress, target.byteLength, target.mediaType, MCPB_MANIFEST_VERSION])).digest("hex")}`;
	return { id: "validation-1", ...target, submissionDigest, state: McpbValidationStates.Pending, manifestName: null, bundleVersion: null, manifestDigest: null, publisher: null, signerFingerprint: null, failureCode: null };
}

/** Build a transaction-bound MCP harness and preserve the calls that prove atomic admission. */
function _Harness(record: McpbValidationRecord, created: boolean): { unitOfWork: McpOperatorUnitOfWork; transaction: McpOperatorTransaction; createOrFind: ReturnType<typeof vi.fn>; find: ReturnType<typeof vi.fn>; appendAudit: ReturnType<typeof vi.fn> }
{
	const createOrFind = vi.fn().mockResolvedValue({ created, validation: record });
	const find = vi.fn().mockResolvedValue(record);
	const appendAudit = vi.fn().mockResolvedValue(undefined);
	const transaction = {
		mcp: { appendAudit },
		mcpbValidations: { createOrFind, find },
		workflowTransaction: { client: {} },
	} as unknown as McpOperatorTransaction;
	const unitOfWork: McpOperatorUnitOfWork = {
		execute: async function _Execute<TResult>(operation: (value: McpOperatorTransaction) => Promise<TResult>): Promise<TResult>
		{
			return await operation(transaction);
		},
	};
	return { unitOfWork, transaction, createOrFind, find, appendAudit };
}

/** Return the workflow stub that records whether it received the caller's database transaction. */
function _Workflow(): McpbValidationWorkflow
{
	return { admit: vi.fn().mockResolvedValue({ taskKey: "workflows:mcpb-validation:test", receipt: { taskId: "task-1", taskName: "mcpb-validation.verify", idempotencyKey: "workflows:mcpb-validation:test" } }) };
}

/** Return an artifact resolver with a caller-provided published target. */
function _Artifacts(target = _Target()): McpbBundleArtifactResolver
{
	return { resolve: vi.fn().mockResolvedValue(target) };
}

describe("MCP bundle validation submission", function _McpbValidationSubmissionSuite()
{
	it("does not open an MCP database transaction when the artifact is not readable", async function _RejectsMissingArtifact()
	{
		const execute = vi.fn();
		const unitOfWork: McpOperatorUnitOfWork = { execute };
		const outcome = await submitMcpbValidation(unitOfWork, _Workflow(), { resolve: vi.fn().mockResolvedValue(null) }, _Caller(), { idempotencyKey: "submission-1", artifactId: "artifact-1", artifactRevisionId: "revision-1" });

		expect(outcome).toEqual({ outcome: McpbValidationSubmissionOutcomes.ArtifactNotFound });
		expect(execute).not.toHaveBeenCalled();
	});

	it("creates the validation, audit entry, and saved job through one database transaction", async function _AdmitsAtomically()
	{
		const record = _Record();
		const harness = _Harness(record, true);
		const workflow = _Workflow();
		const outcome = await submitMcpbValidation(harness.unitOfWork, workflow, _Artifacts(), _Caller(), { idempotencyKey: "submission-1", artifactId: "artifact-1", artifactRevisionId: "revision-1" });

		expect(outcome).toEqual({ outcome: McpbValidationSubmissionOutcomes.Submitted, validation: record });
		expect(harness.createOrFind).toHaveBeenCalledWith(expect.objectContaining({ siloId: "silo-1", createdByPrincipalId: "principal-1", artifactId: "artifact-1", artifactRevisionId: "revision-1" }));
		expect(harness.appendAudit).toHaveBeenCalledWith("Created", "McpbValidation/validation-1", "MCP bundle validation validation-1 submitted", { siloId: "silo-1", actorPrincipalId: "principal-1" });
		expect(workflow.admit).toHaveBeenCalledWith(harness.transaction.workflowTransaction, expect.objectContaining({ siloId: "silo-1", validationId: "validation-1", artifactId: "artifact-1", artifactRevisionId: "revision-1" }));
	});

	it("does not admit a task when a caller reuses its submission key for different input", async function _RejectsConflict()
	{
		const record = _Record();
		const harness = _Harness(record, false);
		harness.createOrFind.mockResolvedValue(null);
		const workflow = _Workflow();
		const outcome = await submitMcpbValidation(harness.unitOfWork, workflow, _Artifacts(), _Caller(), { idempotencyKey: "submission-1", artifactId: "artifact-1", artifactRevisionId: "revision-1" });

		expect(outcome).toEqual({ outcome: McpbValidationSubmissionOutcomes.Conflict });
		expect(workflow.admit).not.toHaveBeenCalled();
	});

	it("admits an oversized published bundle so the workflow records its bounded rejection", async function _AdmitsOversizedBundle()
	{
		const record = _Record(MCPB_MAXIMUM_BUNDLE_BYTES + 1);
		const harness = _Harness(record, true);
		const workflow = _Workflow();
		const outcome = await submitMcpbValidation(harness.unitOfWork, workflow, _Artifacts(_Target(MCPB_MAXIMUM_BUNDLE_BYTES + 1)), _Caller(), { idempotencyKey: "submission-1", artifactId: "artifact-1", artifactRevisionId: "revision-1" });

		expect(outcome).toEqual({ outcome: McpbValidationSubmissionOutcomes.Submitted, validation: record });
		expect(workflow.admit).toHaveBeenCalledWith(harness.transaction.workflowTransaction, expect.objectContaining({ byteLength: MCPB_MAXIMUM_BUNDLE_BYTES + 1 }));
	});

	it("reads a saved validation through the caller's silo-bound repository", async function _ReadsWithinSilo()
	{
		const record = _Record();
		const harness = _Harness(record, false);
		const result = await getMcpbValidation(harness.unitOfWork, _Caller(), record.id);

		expect(result).toEqual(record);
		expect(harness.find).toHaveBeenCalledWith("silo-1", "validation-1");
	});
});
