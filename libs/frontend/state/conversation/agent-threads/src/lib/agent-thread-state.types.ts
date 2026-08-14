import { AgentThreadDeliveryKinds } from "@opencrane/contracts";

/** The route-level state machine for an Agent-thread page. */
export enum AgentThreadRouteStates
{
	/** No authoritative snapshot has completed loading. */
	Loading = "loading",
	/** An authorized snapshot is available to render. */
	Ready = "ready",
	/** The route is absent, foreign, or not authorized; these cases are intentionally identical. */
	Unavailable = "unavailable",
	/** A previously authorized view observed access loss and purged its local child state. */
	AccessChanged = "access_changed"
}

/** Independent access dimension for an authorized parent summary. */
export enum AgentThreadAccessStates
{
	/** Current participants may open the linked child conversation. */
	Available = "available",
	/** The parent may retain only the authorized restricted summary. */
	Restricted = "restricted"
}

/** Independent connection dimension for an authorized child snapshot. */
export enum AgentThreadRecoveryStates
{
	/** The browser has the latest accepted projection and live delivery is connected. */
	Live = "live",
	/** The browser is recovering from its last accepted cursor. */
	Reconnecting = "reconnecting"
}

/** Independent first-run admission dimension. */
export enum AgentThreadAdmissionStates
{
	/** The mention may create a child conversation and first run. */
	Available = "available",
	/** The child and first run exist but execution is waiting for capacity. */
	Queued = "queued",
	/** The signed-in participant may not invoke an Agent in this group. */
	Unauthorized = "unauthorized",
	/** This group has no Agent configured for invocation. */
	NoAgent = "no_agent",
	/** One exact mention command is in flight and duplicates are suppressed. */
	Submitting = "submitting"
}

/** Independent serial-run lifecycle shown inside one Agent thread. */
export enum AgentThreadRunStates
{
	/** The durable run exists and is waiting for execution capacity. */
	Queued = "queued",
	/** The current foreground run is executing. */
	Working = "working",
	/** The run is paused for a participant response or approval. */
	Waiting = "waiting",
	/** A visible attempt failed and the same run is retrying. */
	Retrying = "retrying",
	/** The run completed and may have delivered a safe result. */
	Completed = "completed",
	/** The run ended unsuccessfully without claiming a result. */
	Failed = "failed",
	/** A cancellation superseded the active attempt. */
	Cancelled = "cancelled"
}

/** Parent-summary states derived from child, run, access, and recovery dimensions. */
export enum AgentThreadSummaryStates
{
	/** Atomic child and first-run creation has not reached an authoritative result. */
	Starting = "starting",
	/** The active serial run is working. */
	Working = "working",
	/** The run needs participant input or approval. */
	Waiting = "waiting",
	/** A failed attempt is visibly retrying. */
	Retrying = "retrying",
	/** The latest run completed without a preceding visible retry. */
	Completed = "completed",
	/** The latest run completed after at least one visible retry. */
	CompletedAfterRetry = "completed_after_retry",
	/** The latest run ended unsuccessfully. */
	Failed = "failed",
	/** The latest run was cancelled. */
	Cancelled = "cancelled",
	/** The child conversation is closed and accepts no follow-up. */
	Closed = "closed",
	/** Current parent participants may see only a non-disclosing restricted summary. */
	Restricted = "restricted",
	/** Atomic mention admission failed without creating a usable child. */
	CreationFailed = "creation_failed",
	/** Live delivery is reconnecting from the last accepted cursor. */
	Reconnecting = "reconnecting"
}

/** Canonical focus targets derived from one authorized parent summary. */
export enum AgentThreadSummaryTargetKinds
{
	/** Open the child at its immutable origin and latest timeline context. */
	Thread = "thread",
	/** Focus the delivery that asks for participant input or approval. */
	WaitingRequest = "waiting_request",
	/** Focus the failed run boundary without implying a result. */
	Failure = "failure",
	/** Focus the final result or durable generated asset delivery. */
	FinalResult = "final_result"
}

/** Ordered child timeline entry categories. */
export enum AgentThreadTimelineEntryKinds
{
	/** A serial run began or changed lifecycle state. */
	RunBoundary = "run_boundary",
	/** A participant or Agent message. */
	Message = "message",
	/** An append-only delivery to the immediate parent. */
	Delivery = "delivery"
}
export { AgentThreadDeliveryKinds };
