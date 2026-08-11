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
	/** Number of linked Reserved invocations terminalised without creating resume authority. */
	readonly failedInvocationCount: number;
}

/** Transaction-scoped persistence used by the pure cancellation procedure. */
export interface RunApprovalCancellationRepository
{
	/** Snapshot linked invocation ids before their approvals are closed. */
	findPendingInvocationIds(runId: string, attempt: number): Promise<readonly string[]>;
	/** Close pending approval rows without creating resume markers. */
	cancelPending(runId: string, attempt: number, now: Date): Promise<number>;
	/** Fail only still-reserved invocation links for the cancelling attempt. */
	failReserved(invocationIds: readonly string[], runId: string, attempt: number, now: Date): Promise<number>;
}

/** Transaction binding that owns construction of the cancellation repository. */
export interface RunApprovalCancellationUnitOfWork
{
	/** Close pending approval and invocation authority on the caller-owned transaction. */
	cancel(command: CancelPendingRunApprovalAuthorityCommand): Promise<CancelPendingRunApprovalAuthorityResult>;
}
