import { createHash } from "node:crypto";

import { ArtifactPreprocessTaskDeclaration } from "@opencrane/backend/artifacts/preprocessor/workflows/contract";
import type { IWorkflowEngine, IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";

import { ArtifactPreprocessWorkflowAdmissionError } from "./artifact-preprocess-workflow-admission.types";
import type { ArtifactPreprocessWorkflowAdmission, ArtifactPreprocessWorkflowAdmissionTransaction, ArtifactPreprocessWorkflowRecord } from "./artifact-preprocess-workflow-admission.types";

/**
 * Builds the stable task key for one immutable PDF source revision.
 *
 * Called by: artifact publication and scan transactions before they admit the conversion task.
 * @param record - Immutable source revision and owning silo saved with the preprocessing job.
 * @returns The deterministic workflow idempotency key for this conversion.
 */
export function __ArtifactPreprocessWorkflowTaskKey(record: Pick<ArtifactPreprocessWorkflowRecord, "siloId" | "sourceRevisionId">): string
{
	return `workflows:artifact-preprocess:${createHash("sha256").update(`${record.siloId}\u0000${record.sourceRevisionId}`).digest("hex")}`;
}

/** Reject a task receipt that cannot be the exact record's saved preprocessing task. */
function _Receipt(record: ArtifactPreprocessWorkflowRecord, receipt: IWorkflowTaskReceipt): IWorkflowTaskReceipt
{
	if (receipt.taskId.trim().length === 0 || receipt.taskName !== ArtifactPreprocessTaskDeclaration.taskName || receipt.idempotencyKey !== record.taskKey)
	{
		throw new ArtifactPreprocessWorkflowAdmissionError("Artifact preprocessing workflow returned a conflicting task receipt.");
	}
	return receipt;
}

/**
 * Save the preprocessing task in the exact transaction that published its source PDF.
 *
 * The caller supplies the immutable product record. This function turns it into the identifier-only
 * task input, then rejects a receipt for another task name or task key before the caller can treat
 * it as an admission for this preprocessing job.
 *
 * @param transaction - Product transaction shared with task admission.
 * @param workflow - Guarded engine that saves the declared remote task.
 * @param record - Immutable product facts for one PDF conversion.
 * @returns The record and its matching saved-task receipt.
 * @throws {ArtifactPreprocessWorkflowAdmissionError} When the engine returns a conflicting receipt.
 */
export async function __AdmitArtifactPreprocessWorkflow(transaction: ArtifactPreprocessWorkflowAdmissionTransaction, workflow: Pick<IWorkflowEngine, "spawn">, record: ArtifactPreprocessWorkflowRecord): Promise<ArtifactPreprocessWorkflowAdmission>
{
	const receipt = _Receipt(record, await workflow.spawn(transaction.workflowTransaction, {
		taskName: ArtifactPreprocessTaskDeclaration.taskName,
		idempotencyKey: record.taskKey,
		input: { siloId: record.siloId, preprocessJobId: record.preprocessJobId },
	}));
	return { preprocess: record, receipt };
}
