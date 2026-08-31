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

/**
 * Passes the product database transaction to workflow task admission.
 *
 * Product repositories build this value from their current Prisma transaction. Passing another
 * client would allow the PDF publication and its saved task to commit independently.
 */
export interface ArtifactPreprocessWorkflowAdmissionTransaction
{
	/** Opaque transaction passed unchanged to the workflow engine. */
	readonly workflowTransaction: IWorkflowTransaction;
}

/**
 * Writes the preprocessing record and workflow receipt through a transaction the caller owns.
 *
 * `__CreateAndAdmitArtifactPreprocessWorkflow` in artifact-preprocess-workflow-admission.ts calls
 * `create` before it saves the remote task, because the task input needs the new preprocessing-job
 * id. It then calls `bindTask` before the caller commits. An implementation must use the same
 * database transaction for both methods so a PDF cannot be published with only half of that state.
 *
 * Implemented by: `PrismaArtifactPreprocessWorkflowRepository` in
 * prisma-artifact-preprocess-workflow-admission.ts.
 */
export interface ArtifactPreprocessWorkflowRepository
{
	/** Creates the pending record and returns the job id and task key needed for admission. */
	create(source: Pick<ArtifactPreprocessWorkflowRecord, "siloId" | "sourceRevisionId">): Promise<ArtifactPreprocessWorkflowRecord>;
	/** Saves the admitted task id and name on the pending record before the caller commits. */
	bindTask(record: ArtifactPreprocessWorkflowRecord, receipt: IWorkflowTaskReceipt): Promise<void>;
}

/**
 * Carries both views of the database transaction used to publish PDF preprocessing work.
 *
 * The workflow engine receives `workflowTransaction`, while the product record uses
 * `preprocessWorkflows`. Both must wrap the same database transaction; otherwise the task receipt
 * and preprocessing record could commit independently after a failure.
 *
 * Built by: `PrismaArtifactAuthorityRepository` during publication and
 * `PrismaArtifactScanRepository` after a clean scan.
 */
export interface ArtifactPreprocessWorkflowCreationTransaction extends ArtifactPreprocessWorkflowAdmissionTransaction
{
	/** Transaction-scoped repository for the preprocessing record and receipt binding. */
	readonly preprocessWorkflows: ArtifactPreprocessWorkflowRepository;
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
