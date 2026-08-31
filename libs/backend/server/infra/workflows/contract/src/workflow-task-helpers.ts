import { WorkflowTaskCancelledError, WorkflowTaskRetryableError, WorkflowTaskTerminalError } from "./workflow-engine.types";

/** The one context capability the shared pod-wait needs. */
interface WorkflowSleepContext
{
	/** Durable sleep owned by the workflow engine. */
	sleepUntil(instant: Date, stepName?: string): Promise<void>;
}

/**
 * Builds one stable checkpoint name for a delivery cycle within a long-lived workflow task.
 *
 * Every delivery cycle must produce fresh checkpoint names, or a replayed task would reuse a stale
 * result from an earlier cycle. Sharing the format keeps that rule identical across handlers.
 *
 * Called by: the skill-authoring and artifact-preprocess workflow handlers.
 *
 * @param cycle - Monotonic delivery cycle within one task.
 * @param stepName - Step name unique within one cycle.
 * @returns The namespaced checkpoint name for this cycle and step.
 */
export function ___DeliveryCheckpointName(cycle: number, stepName: string): string
{
	return `delivery-${cycle}:${stepName}`;
}

/**
 * Converts an unavailable dependency into the task's declared retry policy.
 *
 * Errors the workflow engine already understands pass through unchanged; anything else becomes a
 * retryable failure with the caller's message, so an unknown transport or database error cannot
 * terminalize a task that its declaration says must retry.
 *
 * Called by: workflow handlers around every server, database, or Kubernetes exchange.
 *
 * @param operation - The dependency call to guard.
 * @param unavailableMessage - Reader-facing message for the wrapped retryable failure.
 * @returns The operation result, unchanged.
 * @throws WorkflowTaskRetryableError wrapping any unrecognized failure.
 */
export async function ___RetryWorkflowDependency<TResult>(operation: () => Promise<TResult>, unavailableMessage: string): Promise<TResult>
{
	try
	{
		return await operation();
	}
	catch (error)
	{
		if (error instanceof WorkflowTaskCancelledError || error instanceof WorkflowTaskTerminalError || error instanceof WorkflowTaskRetryableError)
		{
			throw error;
		}
		throw new WorkflowTaskRetryableError(unavailableMessage);
	}
}

/**
 * Sleeps once, bounded by the claim expiry, before a handler checks its workload again.
 *
 * The 100ms-60s bound carries the supported poll range every claim-fenced handler inherited from
 * the former controller, so a missing Pod cannot busy-loop Kubernetes or outlive its claim.
 *
 * Called by: the skill-authoring and artifact-preprocess workflow handlers between Pod checks.
 *
 * @param context - The task context that owns durable sleeps.
 * @param milliseconds - Requested wait within the supported poll range.
 * @param claimExpiry - Epoch milliseconds after which the claim is no longer usable.
 * @param stepName - Checkpoint name for this sleep.
 * @throws Error when the requested wait is outside the supported poll range.
 */
export async function ___SleepWithinClaim(context: WorkflowSleepContext, milliseconds: number, claimExpiry: number, stepName: string): Promise<void>
{
	if (!Number.isSafeInteger(milliseconds) || milliseconds < 100 || milliseconds > 60_000)
	{
		throw new Error("workflow handlers require a 100-60000ms Pod wait");
	}
	await context.sleepUntil(new Date(Math.min(Date.now() + milliseconds, claimExpiry)), stepName);
}
