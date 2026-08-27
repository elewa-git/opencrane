import type { IWorkflowTaskReceipt, IWorkflowTransaction } from "@opencrane/backend/server/infra/workflows/contract";

/** Immutable record that binds one published PDF to one durable task. */
export interface ArtifactPreprocessWorkflowRecord
{
	/** Stable preprocessing-job identifier. */
	readonly preprocessJobId: string;
	/** Silo that owns the source PDF and its saved task. */
	readonly siloId: string;
	/** Immutable published PDF revision converted by this task. */
	readonly sourceRevisionId: string;
	/** Deterministic key that lets retried admission reuse the same saved task. */
	readonly taskKey: string;
}

/** Supplies the transaction that product writes and durable task admission must share. */
export interface ArtifactPreprocessWorkflowAdmissionTransaction
{
	/** Opaque transaction passed unchanged to the workflow engine. */
	readonly workflowTransaction: IWorkflowTransaction;
}

/** Returned after the task engine accepted the exact saved preprocessing record. */
export interface ArtifactPreprocessWorkflowAdmission
{
	/** Immutable preprocessing record used to create the task input. */
	readonly preprocess: ArtifactPreprocessWorkflowRecord;
	/** Receipt the engine saved in the caller-owned database transaction. */
	readonly receipt: IWorkflowTaskReceipt;
}

/**
 * Reports a task receipt that does not match the preprocessing record the caller admitted.
 *
 * A caller must let this error fail its surrounding publication transaction; otherwise it could
 * associate the PDF with a task for another job or retry key. `__AdmitArtifactPreprocessWorkflow`
 * throws this error after the workflow engine returns a conflicting receipt.
 */
export class ArtifactPreprocessWorkflowAdmissionError extends Error
{
	/** Creates an admission error with the fixed reason that stopped the product transaction. */
	constructor(message: string)
	{
		super(message);
		this.name = "ArtifactPreprocessWorkflowAdmissionError";
	}
}
