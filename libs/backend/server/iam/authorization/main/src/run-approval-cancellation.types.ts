import type { ExternalActionClaimKinds, ExternalActionRecoveryModes, ToolInvocationStates } from "./tool-invocation-lifecycle.types.js";

/** Exact run-attempt coordinates whose pending approval authority must be cancelled. */
export interface CancelPendingRunApprovalAuthorityCommand
{
	/** Logical run whose pending approvals are no longer resumable. */
	readonly runId: string;
	/** Current positive attempt whose pending approvals are being closed. */
	readonly attempt: number;
	/** Trusted cancellation instant shared with the caller's run-state transition. */
	readonly now: Date;
}

/** Count of pending approval rows atomically closed for one run attempt. */
export interface CancelPendingRunApprovalAuthorityResult
{
	/** Number of Pending approvals transitioned to Cancelled. */
	readonly cancelledCount: number;
	/** Number of nonterminal invocations terminalised with an exact cancellation delivery. */
	readonly failedInvocationCount: number;
	/** Provider-active claims that must settle before the runs owner may finalize Cancelled. */
	readonly activeClaimCount: number;
}

/** Minimal invocation identity needed to persist one cancellation delivery. */
export interface RunCancellationToolInvocation
{
	/** Trusted ToolInvocation database identity. */
	readonly id: string;
	/** Runtime-facing tool-call coordinate embedded in the exact delivery. */
	readonly toolInvocationId: string;
	/** Durable state interpreted by the exhaustive cancellation event planner. */
	readonly state: ToolInvocationStates;
	/** Frozen recovery capability retained for the complete planner input. */
	readonly recoveryMode: ExternalActionRecoveryModes;
	/** Null for cancellable work; a non-null claim proves provider I/O may be in flight. */
	readonly claimKind: ExternalActionClaimKinds | null;
	/** Provider-free attempts consumed before cancellation. */
	readonly preparationAttempt: number;
	/** Hard preparation deadline used by the complete planner input. */
	readonly retryDeadlineAt: Date;
	/** Exact lifecycle compare-and-set revision. */
	readonly revision: number;
}

/** Transaction-scoped persistence used by the pure cancellation procedure. */
export interface RunApprovalCancellationRepository
{
	/** Snapshot every nonterminal invocation after the run enters Cancelling. */
	findCancellableInvocations(runId: string, attempt: number): Promise<readonly RunCancellationToolInvocation[]>;
	/** Close pending approval rows without creating resume markers. */
	cancelPending(runId: string, attempt: number, now: Date): Promise<number>;
	/** Fail every snapshotted nonterminal invocation and create exact deliveries. */
	terminaliseCancellable(invocations: readonly RunCancellationToolInvocation[], runId: string, attempt: number, now: Date): Promise<number>;
	/** Count exact provider-active claims that cancellation must leave fenced. */
	countActiveClaims(runId: string, attempt: number): Promise<number>;
}

/** Transaction binding that owns construction of the cancellation repository. */
export interface RunApprovalCancellationUnitOfWork
{
	/** Close pending approval and invocation authority on the caller-owned transaction. */
	cancel(command: CancelPendingRunApprovalAuthorityCommand): Promise<CancelPendingRunApprovalAuthorityResult>;
}
