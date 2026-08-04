/** Stable public outcome of evaluating one schedule tick. */
export enum ScheduleTickStatuses
{
	/** The schedule is disabled and no persistence or run admission occurs. */
	Suspended = "suspended",
	/** The schedule or its service is not safe to evaluate and fails closed. */
	InvalidSchedule = "invalid_schedule",
	/** Evaluation completed and reports every processed due slot. */
	Ticked = "ticked",
}

/** Stable reason that makes a schedule tick fail closed before it can admit a run. */
export enum ScheduleInvalidReasons
{
	/** The persisted cron expression is malformed. */
	InvalidCron = "invalid_cron",
	/** The persisted IANA timezone cannot be resolved. */
	InvalidTimezone = "invalid_timezone",
	/** The managed service has no active revision that can receive the slot. */
	ServiceNotRunnable = "service_not_runnable",
}

/** Stable per-slot outcome emitted by the scheduler after consulting run admission. */
export enum ScheduledSlotOutcomes
{
	/** The shared run-admission authority accepted a new durable run. */
	Accepted = "accepted",
	/** A concurrent or retried tick resolved to the already-admitted durable run. */
	Idempotent = "idempotent",
	/** Overlap policy deliberately discarded this due slot. */
	SkippedOverlap = "skipped_overlap",
	/** A transient admission refusal leaves the cursor in place for a later retry. */
	RetryHint = "retry_hint",
	/** A permanent admission refusal was recorded and the cursor can advance. */
	Denied = "denied",
}

/** Durable cursor compare-and-set outcome returned by the scheduler persistence boundary. */
export enum ScheduleCursorAdvanceOutcomes
{
	/** The observed schedule version still matched and the cursor moved forward. */
	Advanced = "advanced",
	/** Another tick or a schedule edit changed the observed version, so this result was discarded. */
	Stale = "stale",
}
