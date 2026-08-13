/**
 * The result of evaluating one schedule once.
 *
 * `Suspended` means the schedule is switched off: nothing is read, admitted, or written, and the row
 * is left alone rather than deleted. `InvalidSchedule` means the stored configuration cannot be
 * trusted (see {@link ScheduleInvalidReasons}), so the tick fails closed and logs a warning instead
 * of guessing at an interpretation. `Ticked` is the only status that reports slots and the cursor
 * the tick reached - note that a `Ticked` result with an empty outcome list just means nothing was
 * due.
 */
export enum ScheduleTickStatuses
{
	/** The schedule is disabled and no persistence or run admission occurs. */
	Suspended = "suspended",
	/** The schedule or its service is not safe to evaluate and fails closed. */
	InvalidSchedule = "invalid_schedule",
	/** Evaluation completed and reports every processed due slot. */
	Ticked = "ticked",
}

/**
 * Why a schedule could not be evaluated at all, so no run was admitted.
 *
 * All three are operator-side problems rather than transient faults, and none of them are retried in
 * a tighter loop - the next ordinary tick tries again once the row or the service is fixed.
 * `InvalidCron` and `InvalidTimezone` mean the stored expression or IANA zone name cannot be parsed,
 * and the scheduler refuses to guess because a wrong reading would fire runs at wrong times.
 * `ServiceNotRunnable` means the managed service has no active revision to hand the slot to - most
 * often it is paused or mid-deploy - so there is nothing to run yet.
 */
export enum ScheduleInvalidReasons
{
	/** The persisted cron expression is malformed. */
	InvalidCron = "invalid_cron",
	/** The persisted IANA timezone cannot be resolved. */
	InvalidTimezone = "invalid_timezone",
	/** The managed service has no active revision that can receive the slot. */
	ServiceNotRunnable = "service_not_runnable",
}

/**
 * What happened to one due slot after the scheduler asked the run-admission authority.
 *
 * The five are easy to confuse, and they differ in whether the cursor may move past the slot:
 * - `Accepted` - a new run was created for this slot; the cursor moves on.
 * - `Idempotent` - a concurrent or repeated tick had already created that exact run, so this is
 *   success and not a clash; the cursor moves on.
 * - `SkippedOverlap` - the schedule's overlap policy is `skip` and an earlier scheduled run is still
 *   going, so the slot is deliberately dropped and will not fire later; the cursor moves on.
 * - `RetryHint` - admission was refused for a reason that may pass (stale membership, a concurrency
 *   limit, the database unavailable). The tick stops here and the cursor does NOT move, so the next
 *   tick retries the same slot. `retryAfterMs` is advice only; nothing in this package sleeps.
 * - `Denied` - admission refused permanently. The refusal is recorded and the cursor moves past it,
 *   so one bad slot cannot block the schedule forever.
 */
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

/**
 * Whether a finished tick was allowed to record how far it got.
 *
 * Each schedule keeps a cursor - `lastScheduledAt`, the newest slot it has already dealt with - and
 * only slots after it are ever considered. The cursor must therefore never move backwards: if it
 * did, slots that were already admitted would look due again and the same work would start twice.
 * To guarantee that, the update applies only if the schedule row still holds both the version and
 * the previous cursor the tick read before it began admitting runs.
 *
 * `Advanced` means it applied. `Stale` means somebody edited the schedule, or another tick moved the
 * cursor, in the meantime - so this tick's cursor is discarded rather than written. The runs it
 * already admitted stay safe because each slot carries its own idempotency key, and the next tick
 * simply recomputes from the stored cursor. `Stale` is normal and is logged at debug, not as an
 * error.
 *
 * @see {@link ScheduleCursorRepository.advanceIfUnchanged} the call that returns this.
 */
export enum ScheduleCursorAdvanceOutcomes
{
	/** The observed schedule version still matched and the cursor moved forward. */
	Advanced = "advanced",
	/** Another tick or a schedule edit changed the observed version, so this result was discarded. */
	Stale = "stale",
}
