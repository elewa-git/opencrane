import type { IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";

import type { SkillAuthoringValidationCompletion, SkillAuthoringValidationPodBindCommand, SkillAuthoringValidationWorkloadBindCommand } from "./skill-authoring-validation-controller.types";

/**
 * Carries the saved task receipt and Job evidence for one suspended authoring Job.
 *
 * Called by: `__ParseSkillAuthoringValidationWorkloadBindRequest`, which returns it only after the
 * server-owned authoring namespace matches the request. The authority stores this evidence before
 * the controller releases the Job.
 */
export interface SkillAuthoringValidationWorkloadBindRequest
{
	/** Exact task receipt saved during validation admission. */
	readonly task: IWorkflowTaskReceipt;
	/** Job identity, one-use bootstrap, and profile namespace that the server will recheck. */
	readonly command: SkillAuthoringValidationWorkloadBindCommand;
}

/**
 * Carries the saved task receipt and first-Pod evidence for a recorded authoring Job.
 *
 * Called by: `__ParseSkillAuthoringValidationPodBindRequest`. The authority accepts it only for
 * the same claimed Job delivery and stores the Pod UID before worker bootstrap can succeed.
 */
export interface SkillAuthoringValidationPodBindRequest
{
	/** Exact task receipt saved during validation admission. */
	readonly task: IWorkflowTaskReceipt;
	/** Fenced Job and first-Pod identities that the server will recheck. */
	readonly command: SkillAuthoringValidationPodBindCommand;
}

/**
 * Carries the saved task receipt and digest used to read completion evidence from the inbox.
 *
 * Called by: `__ParseSkillAuthoringValidationCompletionLoadRequest`. The digest identifies a
 * server-owned inbox record; it does not let the controller supply a completion result.
 */
export interface SkillAuthoringValidationCompletionLoadRequest
{
	/** Exact task receipt saved during validation admission. */
	readonly task: IWorkflowTaskReceipt;
	/** Immutable digest that identifies one server-owned completion inbox row. */
	readonly completionDigest: string;
}

/**
 * Carries the saved task receipt and completion identity for the terminal validation write.
 *
 * Called by: `__ParseSkillAuthoringValidationCompletionRequest`. The authority rechecks that this
 * identity is an inbox record for the route validation before it changes terminal state.
 */
export interface SkillAuthoringValidationCompletionRequest
{
	/** Exact task receipt saved during validation admission. */
	readonly task: IWorkflowTaskReceipt;
	/** Completion identity that the server will match to the route validation id and inbox. */
	readonly completion: SkillAuthoringValidationCompletion;
}
