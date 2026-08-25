import { WorkflowTaskRetryBackoffKinds } from "@opencrane/backend/server/infra/workflows/contract";
import type { IWorkflowTaskDeclaration } from "@opencrane/backend/server/infra/workflows/contract";

/**
 * Names the remote task that validates one Draft Python skill revision.
 *
 * The server declares this name without a handler and the controller later registers the handler.
 * The shared name keeps a task saved with a product transaction routable to that controller.
 */
export enum SkillAuthoringValidationTaskNames
{
	/** Runs the isolated authoring Job and saves its final review evidence. */
	Validate = "skills.authoring.validate/v1",
}

/**
 * Identifies one admitted task without carrying artifact bytes or credentials.
 *
 * The controller reloads the server-owned validation from these identifiers before it creates a
 * Kubernetes Job.
 */
export interface SkillAuthoringValidationTaskInput
{
	/** Silo that owns both the saved validation and the remote workflow task. */
	readonly siloId: string;
	/** Stable product record that binds the task to the immutable skill coordinates. */
	readonly validationId: string;
}

/**
 * Defines the declaration that the server admits and the controller handler later registers.
 *
 * The server composition assigns this declaration to `skill-authoring` and mounts the private
 * controller lifecycle API, but adds no server handler. A product admission adapter and deployable
 * controller-handler registration are still pending.
 *
 * @see __AdmitSkillAuthoringValidation — applies the transaction-bound admission rule.
 * @see __CreateSkillAuthoringValidationHandler — supplies the controller handler.
 */
export const SkillAuthoringValidationTaskDeclaration = {
	taskName: SkillAuthoringValidationTaskNames.Validate,
	retryPolicy: { maximumAttempts: 3, backoff: { kind: WorkflowTaskRetryBackoffKinds.Exponential, initialDelaySeconds: 30, multiplier: 2, maximumDelaySeconds: 300 } },
} as const satisfies IWorkflowTaskDeclaration;
