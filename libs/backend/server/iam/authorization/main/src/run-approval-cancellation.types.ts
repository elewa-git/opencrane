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
}
