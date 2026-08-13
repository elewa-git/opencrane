/**
 * The run states this package needs to reason about approvals.
 *
 * A deliberate copy of the runs package's state names rather than an import, so approval logic
 * stays independent of the runs package. Only `Running` and `WaitingForApproval` can take part in
 * an approval; every other member exists so the decision table is exhaustive and adding a run
 * state forces an explicit choice here.
 * @see {@link DeferredToolApprovalLifecycleActions}
 */
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
	/** Paused because an external provider outcome needs explicit recovery. */
	RecoveryRequired = "recovery_required",
	/** Closing after server-authoritative cancellation. */
	Cancelling = "cancelling",
	/** Completed successfully. */
	Completed = "completed",
	/** Failed terminally. */
	Failed = "failed",
	/** Cancelled terminally. */
	Cancelled = "cancelled",
}

/**
 * The four things that can happen to a run's approvals.
 *
 * `Decision` and `Expiry` both resolve one approval and are handled identically by the run-state
 * table — which one it was matters only for the approval row, not for the run.
 */
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

/**
 * The one write allowed for a run when an approval opens, resolves, or is cancelled.
 *
 * Chosen by {@link __PlanDeferredToolApprovalLifecycle} from the run state, the event, and how many
 * approvals are still pending. The count is what separates the near-identical pairs:
 * `PauseAndOpen` is the first approval on a running run (pause it), `OpenInBatch` is a later one
 * (already paused). `Resume` fires only when the last pending approval resolves; `KeepWaiting`
 * while any remain. Act on `KeepWaiting` as if it were `Resume` and the run restarts while a
 * reviewer is still deciding.
 *
 * `Reject` means the event is invalid for the run's current state and nothing may be written.
 */
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
