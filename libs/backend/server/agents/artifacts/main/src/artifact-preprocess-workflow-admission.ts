import { createHash } from "node:crypto";

import { ArtifactPreprocessTaskDeclaration } from "@opencrane/backend/artifacts/preprocessor/workflows/contract";
import type { IWorkflowEngine, IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";

import { ArtifactPreprocessWorkflowAdmissionError } from "./artifact-preprocess-workflow-admission.types";
import type { ArtifactPreprocessWorkflowAdmissionTransaction, ArtifactPreprocessWorkflowCreationTransaction, ArtifactPreprocessWorkflowRecord } from "./artifact-preprocess-workflow-admission.types";

/**
 * Builds the stable task key for one immutable PDF source revision.
 *
 * Called by: `PrismaArtifactPreprocessWorkflowRepository.create` before it inserts the pending job.
 * @param record - Immutable source revision and owning silo saved with the preprocessing job.
 * @returns The deterministic workflow idempotency key for this conversion.
 */
export function __ArtifactPreprocessWorkflowTaskKey(record: Pick<ArtifactPreprocessWorkflowRecord, "siloId" | "sourceRevisionId">): string
{
	return `workflows:artifact-preprocess:${createHash("sha256").update(`${record.siloId}\u0000${record.sourceRevisionId}`).digest("hex")}`;
}

/** Rejects a task receipt that cannot belong to the record's saved preprocessing task. */
function _Receipt(record: ArtifactPreprocessWorkflowRecord, receipt: IWorkflowTaskReceipt): IWorkflowTaskReceipt
{
	if (receipt.taskId.trim().length === 0 || receipt.taskName !== ArtifactPreprocessTaskDeclaration.taskName || receipt.idempotencyKey !== record.taskKey)
	{
		throw new ArtifactPreprocessWorkflowAdmissionError("Artifact preprocessing workflow returned a conflicting task receipt.");
	}
	return receipt;
}

/**
 * Saves the preprocessing task in the database transaction that published its source PDF.
 *
 * The caller supplies the immutable product record. This function turns it into the identifier-only
 * task input, then rejects a receipt for another task name or task key before the caller can treat
 * it as an admission for this preprocessing job.
 *
 * Called by: {@link __CreateAndAdmitArtifactPreprocessWorkflow} after it creates the product record.
 * @param transaction - Product transaction shared with task admission.
 * @param workflow - Guarded engine that saves the declared remote task.
 * @param record - Immutable product facts for one PDF conversion.
 * @returns The matching saved-task receipt.
 * @throws {ArtifactPreprocessWorkflowAdmissionError} When the engine returns a conflicting receipt.
 */
export async function __AdmitArtifactPreprocessWorkflow(transaction: ArtifactPreprocessWorkflowAdmissionTransaction, workflow: Pick<IWorkflowEngine, "spawn">, record: ArtifactPreprocessWorkflowRecord): Promise<IWorkflowTaskReceipt>
{
	return _Receipt(record, await workflow.spawn(transaction.workflowTransaction, {
		taskName: ArtifactPreprocessTaskDeclaration.taskName,
		idempotencyKey: record.taskKey,
		input: { siloId: record.siloId, preprocessJobId: record.preprocessJobId },
	}));
}

/**
 * Creates the pending PDF record, saves its remote task, and binds the receipt in one transaction.
 *
 * Called by: `PrismaArtifactAuthorityRepository.finalizeRevisionAtomically` during PDF publication
 * and `PrismaArtifactScanRepository.complete` after a clean PDF scan.
 *
 * @param transaction - Product and workflow persistence ports bound to the same database transaction.
 * @param workflow - Guarded engine that saves the declared remote task.
 * @param source - Published PDF revision and its owning silo.
 * @returns Nothing after the record and matching task receipt are both saved.
 * @throws {ArtifactPreprocessWorkflowAdmissionError} When task admission returns a conflicting
 *   receipt. Persistence errors also escape so the caller rolls back the product transaction.
 * @see ArtifactPreprocessWorkflowCreationTransaction for the shared transaction contract.
 */
export async function __CreateAndAdmitArtifactPreprocessWorkflow(transaction: ArtifactPreprocessWorkflowCreationTransaction, workflow: Pick<IWorkflowEngine, "spawn">, source: Pick<ArtifactPreprocessWorkflowRecord, "siloId" | "sourceRevisionId">): Promise<void>
{
	const record = await transaction.preprocessWorkflows.create(source);
	const receipt = await __AdmitArtifactPreprocessWorkflow(transaction, workflow, record);
	await transaction.preprocessWorkflows.bindTask(record, receipt);
}
