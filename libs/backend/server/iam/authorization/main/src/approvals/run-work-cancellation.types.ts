import type { ExternalActionRecoveryModes, ToolInvocationStates } from "../tool-invocations/tool-invocation-lifecycle.types";

/** Identifies a cancelling run attempt whose pending work must close. */
export interface RunWorkCancellationCommand
{
	/** Identifies the run. */
	readonly runId: string;
	/** Fences cancellation to the current attempt. */
	readonly attempt: number;
	/** Supplies the cancellation decision time. */
	readonly now: Date;
}

/** Reports cleanup progress without treating provider ambiguity as cancellation. */
export interface RunWorkCancellationResult
{
	/** Counts approval requests moved from Pending to Cancelled. */
	readonly cancelledApprovalCount: number;
	/** Counts elicitation requests moved from Requested to Cancelled. */
	readonly cancelledElicitationCount: number;
	/** Counts provider-free invocations moved to Failed. */
	readonly failedInvocationCount: number;
	/** Counts invocations that still hold provider claims. */
	readonly activeClaimCount: number;
	/** Supplies the earliest active claim expiry so durable cleanup can resume without polling. */
	readonly nextClaimExpiryAt: Date | null;
}

/** Captures fields checked by the cancellation planner and conditional update. */
export interface RunWorkCancellationInvocation
{
	/** Identifies the ToolInvocation row. */
	readonly id: string;
	/** Identifies the model's tool call for result delivery. */
	readonly toolInvocationId: string;
	/** Records the lifecycle state. */
	readonly state: ToolInvocationStates;
	/** Records recovery behavior fixed before dispatch. */
	readonly recoveryMode: ExternalActionRecoveryModes;
	/** Counts provider-free preparation attempts. */
	readonly preparationAttempt: number;
	/** Supplies the fixed preparation deadline. */
	readonly retryDeadlineAt: Date;
	/** Fences the invocation update. */
	readonly revision: number;
}

/** Closes pending interaction and provider-free tool work in a caller-owned transaction. */
export interface RunWorkCancellationRepository
{
	/** Applies cleanup on the repository's caller-owned transaction after Kurrent recorded cancellation as the terminal winner. */
	cancel(command: RunWorkCancellationCommand): Promise<RunWorkCancellationResult>;
}
