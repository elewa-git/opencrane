import { WorkflowTaskRetryBackoffKinds } from "@opencrane/backend/server/infra/workflows/contract";
import type { IWorkflowTaskDeclaration } from "@opencrane/backend/server/infra/workflows/contract";

/**
 * Names the remote task that validates one Draft Python skill revision.
 *
 * The server admits this task without hosting its handler, while the controller later registers a
 * handler with the same name. The shared name keeps a task saved with the product transaction
 * routable to the controller.
 */
export enum SkillAuthoringValidationTaskNames
{
	/** The controller runs the isolated authoring Job and asks the server to apply its saved completion. */
	Validate = "skills.authoring.validate/v1",
}

/**
 * Identifies one validation that the server admitted to the authoring workflow.
 *
 * It deliberately carries identifiers rather than artifact bytes or credentials. The controller
 * must reload the server-owned record before it creates a Kubernetes Job.
 */
export interface SkillAuthoringValidationTaskInput
{
	/** Names the silo that must still own the validation when the controller begins work. */
	readonly siloId: string;
	/** Names the validation record for the Draft Python skill revision being checked. */
	readonly validationId: string;
}

/**
 * Defines the declaration that the server admits and the controller handler later registers.
 *
 * The server places this task on `skill-authoring` and declares it without a local handler, so a
 * product transaction can save the task without making the server execute it. The controller uses
 * the same declaration when it supplies the Kubernetes-mutating handler. Its capped exponential
 * retry schedule matches the MCPB validation tasks.
 *
 * @see __CreateSkillAuthoringValidationHandler — adds the controller-only handler to this declaration.
 * @see __CreateMcpbValidationWorkflow — registers MCPB validation with the matching retry schedule.
 */
export const SkillAuthoringValidationTaskDeclaration = {
	taskName: SkillAuthoringValidationTaskNames.Validate,
	retryPolicy: { maximumAttempts: 3, backoff: { kind: WorkflowTaskRetryBackoffKinds.Exponential, initialDelaySeconds: 30, multiplier: 2, maximumDelaySeconds: 300 } },
} as const satisfies IWorkflowTaskDeclaration;
