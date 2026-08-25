import type { IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";

import type { ArtifactPreprocessPodBindCommand, ArtifactPreprocessWorkloadBindCommand } from "./artifact-preprocess-controller.types";

/**
 * Carries the parsed task receipt and Job evidence from one controller bind request.
 *
 * The parser returns this request only after the receipt, delivery fence, bootstrap reference, and
 * worker namespace match the controller contract. The server authority decides whether to record it.
 */
export interface ArtifactPreprocessWorkloadBindRequest
{
	/** Identifies the saved workflow task that may bind this Job. */
	readonly task: IWorkflowTaskReceipt;
	/** Carries the delivery fence, Job UID, bootstrap reference, and worker namespace. */
	readonly command: ArtifactPreprocessWorkloadBindCommand;
}

/**
 * Carries the parsed task receipt and first-Pod evidence from one controller bind request.
 *
 * The parser requires the delivery fence and first-Pod identity; the server authority decides
 * whether to record the binding.
 */
export interface ArtifactPreprocessPodBindRequest
{
	/** Identifies the saved workflow task that may bind this Pod. */
	readonly task: IWorkflowTaskReceipt;
	/** Carries the delivery fence and first Pod UID. */
	readonly command: ArtifactPreprocessPodBindCommand;
}
