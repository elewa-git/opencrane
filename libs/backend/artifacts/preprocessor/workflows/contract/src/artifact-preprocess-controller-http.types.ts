import type { IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";

import type { ArtifactPreprocessPodBindCommand, ArtifactPreprocessRecoveryCommand, ArtifactPreprocessWorkloadBindCommand } from "./artifact-preprocess-controller.types";

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

/**
 * Carries a controller recovery request after the private HTTP parser verifies every binding field.
 *
 * The parser accepts this request only when it contains the admitted task, the bound Job and first
 * Pod identities, and a known recovery reason. `__CreateArtifactPreprocessControllerRouter` passes
 * the result to the server authority; an invalid body remains `null` and cannot change product
 * state.
 *
 * Called by: `__ParseArtifactPreprocessRecoveryRequest`, then
 * `__CreateArtifactPreprocessControllerRouter`.
 */
export interface ArtifactPreprocessRecoveryRequest
{
	/** Identifies the admitted workflow task that the server must match to the failed delivery. */
	readonly task: IWorkflowTaskReceipt;
	/** Carries the binding and recovery reason that the server must verify before saving failure. */
	readonly command: ArtifactPreprocessRecoveryCommand;
}
