/** Dependency-light run states interpreted by the approval lifecycle owner. */
export enum DeferredToolApprovalRunStates
{
	/** Accepted but not yet queued. */
	Accepted = "accepted",
	/** Awaiting dispatch. */
	Queued = "queued",
	/** Bound to an attempt workload. */
	Assigned = "assigned",
	/** Executing and able to open an approval batch. */
	Running = "running",
	/** Paused while one or more approvals remain pending. */
	WaitingForApproval = "waiting_for_approval",
	/** Closing after server-authoritative cancellation. */
	Cancelling = "cancelling",
	/** Completed successfully. */
	Completed = "completed",
	/** Failed terminally. */
	Failed = "failed",
	/** Cancelled terminally. */
	Cancelled = "cancelled",
}

/** Durable events interpreted by the deferred-tool approval run-state owner. */
export enum DeferredToolApprovalLifecycleEvents
{
	/** Adds one approval to a running or already-waiting batch. */
	Open = "open",
	/** Resolves one approval by an authenticated actor decision. */
	Decision = "decision",
	/** Resolves every due approval at a trusted server instant. */
	Expiry = "expiry",
	/** Closes pending approvals because the owning run is cancelling. */
	Cancellation = "cancellation",
}

/** Exhaustive persistence actions selected from run state, event, and pending cardinality. */
export enum DeferredToolApprovalLifecycleActions
{
	/** Move Running to WaitingForApproval before creating the first approval. */
	PauseAndOpen = "pause_and_open",
	/** Keep WaitingForApproval while adding another approval to the current batch. */
	OpenInBatch = "open_in_batch",
	/** Keep WaitingForApproval because at least one request is still pending. */
	KeepWaiting = "keep_waiting",
	/** Move WaitingForApproval to Running because the batch is fully resolved. */
	Resume = "resume",
	/** Close pending rows under a cancellation transaction without resuming the run. */
	Cancel = "cancel",
	/** Reject an event that is invalid for the observed durable run state. */
	Reject = "reject",
}

/** State x event input consumed by the pure approval lifecycle table. */
export interface DeferredToolApprovalLifecycleInput
{
	/** Durable run state observed under the transaction owner's run fence. */
	readonly runState: DeferredToolApprovalRunStates;
	/** Lifecycle event being applied. */
	readonly event: DeferredToolApprovalLifecycleEvents;
	/** Number of requests still pending after the event's approval-row mutation. */
	readonly pendingCount: number;
}
