import { WorkflowError, WorkflowTaskRetryBackoffKinds } from "./workflow-engine.types";
import type { IWorkflowTaskDeclaration, IWorkflowTaskRetryPolicy } from "./workflow-engine.types";

/**
 * Validate and normalize one declaration before an engine permits task admission.
 *
 * Called by: every workflow adapter that stores local or remote task declarations.
 * @param declaration - Stable task name and optional retry policy supplied by composition.
 * @returns A declaration with the validated one-attempt default made explicit.
 * @throws WorkflowError when the task name, attempt count, or retry delay is invalid.
 */
export function __NormalizeWorkflowTaskDeclaration(declaration: IWorkflowTaskDeclaration): Required<IWorkflowTaskDeclaration>
{
	if (declaration.taskName.trim().length === 0)
		throw new WorkflowError("declaration.taskName must be a non-empty string.");
	return { taskName: declaration.taskName, retryPolicy: __NormalizeWorkflowTaskRetryPolicy(declaration.retryPolicy) };
}

/**
 * Validate a retry policy and supply the no-retry default used for persisted admission.
 *
 * Called by: workflow declaration registries and task adapters before mapping into an engine.
 * @param policy - Optional engine-neutral retry policy supplied by task composition.
 * @returns The validated policy, or the one-attempt default when none was supplied.
 * @throws WorkflowError when an attempt or delay value is outside the supported range.
 */
export function __NormalizeWorkflowTaskRetryPolicy(policy: IWorkflowTaskRetryPolicy | undefined): IWorkflowTaskRetryPolicy
{
	const value = policy ?? { maximumAttempts: 1, backoff: { kind: WorkflowTaskRetryBackoffKinds.Fixed, initialDelaySeconds: 0 } };
	if (!Number.isSafeInteger(value.maximumAttempts) || value.maximumAttempts < 1 || value.maximumAttempts > 100)
		throw new WorkflowError("retryPolicy.maximumAttempts must be between 1 and 100.");
	if (!Number.isSafeInteger(value.backoff.initialDelaySeconds) || value.backoff.initialDelaySeconds < 0 || value.backoff.initialDelaySeconds > 86_400)
		throw new WorkflowError("retryPolicy.initialDelaySeconds must be between 0 and 86400.");
	if (value.backoff.multiplier !== undefined && (!Number.isFinite(value.backoff.multiplier) || value.backoff.multiplier < 0))
		throw new WorkflowError("retryPolicy.multiplier must be a finite non-negative number.");
	if (value.backoff.maximumDelaySeconds !== undefined && (!Number.isSafeInteger(value.backoff.maximumDelaySeconds) || value.backoff.maximumDelaySeconds < 0 || value.backoff.maximumDelaySeconds > 86_400))
		throw new WorkflowError("retryPolicy.maximumDelaySeconds must be between 0 and 86400.");
	return value;
}

/** Return whether two normalized declarations select the same persisted retry behavior. */
export function __HaveSameWorkflowTaskRetryPolicy(left: IWorkflowTaskRetryPolicy, right: IWorkflowTaskRetryPolicy): boolean
{
	return left.maximumAttempts === right.maximumAttempts && left.backoff.kind === right.backoff.kind && left.backoff.initialDelaySeconds === right.backoff.initialDelaySeconds && left.backoff.multiplier === right.backoff.multiplier && left.backoff.maximumDelaySeconds === right.backoff.maximumDelaySeconds;
}
