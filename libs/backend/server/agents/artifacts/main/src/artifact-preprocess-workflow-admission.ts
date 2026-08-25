import { createHash } from "node:crypto";

import { ArtifactPreprocessTaskDeclaration } from "@opencrane/backend/artifacts/preprocessor/workflows/contract";
import type { IWorkflowEngine, IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";

import { ArtifactPreprocessWorkflowAdmissionError } from "./artifact-preprocess-workflow-admission.types";
import type { ArtifactPreprocessWorkflowAdmission, ArtifactPreprocessWorkflowAdmissionTransaction, ArtifactPreprocessWorkflowRecord } from "./artifact-preprocess-workflow-admission.types";

/**
 * Builds the stable key for one PDF conversion task from the immutable product record.
 *
 * A serializable retry of the publication transaction calculates the same key and therefore reuses
 * the same Absurd task instead of creating a second conversion. The controller handler is later
 * work, so this helper establishes idempotency without starting PDF processing.
 *
 * Called by: `PrismaArtifactAuthorityRepository.finalizeRevisionAtomically`, while it saves the
 * preprocessing job and its task in one transaction.
 *
 * @param record - The saved PDF preprocessing record and its owning silo.
 * @returns The bounded workflow idempotency key for that one record.
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
 * Called by: `PrismaArtifactAuthorityRepository.finalizeRevisionAtomically`, after it creates the
 * PDF preprocessing job in the same transaction.
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
