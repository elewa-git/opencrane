import type { IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";
import type { RuntimeWorkloadBinding, RuntimeWorkloadClaim } from "@opencrane/backend/agents/runtime/workloads/contract";

import type { SkillAuthoringValidationCompletion, SkillAuthoringValidationPodBindCommand, SkillAuthoringValidationWorkloadBindCommand } from "./skill-authoring-validation-controller.types";
import type { SkillAuthoringValidationRecoveryReasons } from "./skill-authoring-validation-controller.types";

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

/** Carries the saved task and exact bound Job for the database-time release check. */
export interface SkillAuthoringValidationReleaseRequest
{
	/** Exact task receipt saved during validation admission. */
	readonly task: IWorkflowTaskReceipt;
	/** Current claim delivery and immutable Job identity. */
	readonly binding: RuntimeWorkloadBinding;
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

/** Carries a task-owned recovery decision for the exact saved Job binding. */
export interface SkillAuthoringValidationRecoveryRequest
{
	/** Exact task receipt saved during validation admission. */
	readonly task: IWorkflowTaskReceipt;
	/** Current claim delivery and immutable Job identity. */
	readonly binding: RuntimeWorkloadBinding;
	/** Stable reason derived from Kubernetes observation. */
	readonly reason: SkillAuthoringValidationRecoveryReasons;
}

/** Carries the final expired claim for a validation that never bound a Job. */
export interface SkillAuthoringValidationUnboundExpiryRequest
{
	/** Exact task receipt saved during validation admission. */
	readonly task: IWorkflowTaskReceipt;
	/** Final server-issued claim that expired before workload binding. */
	readonly claim: RuntimeWorkloadClaim;
}
