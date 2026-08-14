import type { AgentServiceSchedule, ScheduleTickResult } from "./schedule-tick.types";
import type { ScheduleCursorAdvanceOutcomes } from "./schedule-tick.enums";

/**
 * One enabled schedule plus the service facts observed in the same read.
 *
 * Read together on purpose: the tick has to judge the schedule and whether its service can actually
 * accept a run as of the same moment. `activeRevisionId` is null when the service is not runnable,
 * which the tick reports as `ServiceNotRunnable` instead of admitting anything. `updatedAt` is
 * carried along so the later cursor write can be made conditional on the row not having changed
 * since this read.
 */
export interface EnabledScheduleSnapshot
{
	/** Scheduler-owned schedule coordinates and evaluation policy. */
	readonly schedule: AgentServiceSchedule;
	/** Active managed revision observed with the schedule, or null when the service is not runnable. */
	readonly activeRevisionId: string | null;
	/** The row's last-update time when it was read; the later cursor write only applies if it is still this. */
	readonly updatedAt: string;
}

/** Capability repository that reads only enabled schedule snapshots. */
export interface EnabledScheduleSnapshotRepository
{
	/** Lists every currently enabled schedule with its service's observed runnable revision. */
	listEnabledSnapshots(): Promise<readonly EnabledScheduleSnapshot[]>;
}

/** Capability repository that answers the narrow overlap question for one schedule. */
export interface ActiveScheduledRunRepository
{
	/** Returns true only when a non-terminal scheduled run already exists for this service in this silo. */
	hasActiveScheduledRun(agentServiceId: string, siloId: string): Promise<boolean>;
}

/**
 * A request to record how far one tick got, which the database may refuse.
 *
 * The two `expected*` fields are the whole point: they are the schedule version and cursor the tick
 * read BEFORE it began admitting runs, and the update applies only if both are still those values.
 * Runs are admitted outside any transaction - they are slow, and holding a transaction across them
 * would be worse - so a schedule edit or a second scheduler can land in between. This check is what
 * stops a late tick from dragging the cursor back over slots that already fired.
 *
 * @see {@link ScheduleCursorAdvanceOutcomes} for the two possible answers.
 */
export interface AdvanceScheduleCursorCommand
{
	/** Schedule that owns the cursor. */
	readonly scheduleId: string;
	/** Silo that owns both the schedule and cursor. */
	readonly siloId: string;
	/** Exact schedule version observed before external run admission. */
	readonly expectedUpdatedAt: string;
	/** Exact prior cursor observed before external run admission. */
	readonly expectedLastScheduledAt: string | null;
	/** Newer slot that was admitted, skipped, or permanently refused. */
	readonly nextLastScheduledAt: string;
}

/** Result of a cursor compare-and-set. */
export interface AdvanceScheduleCursorResult
{
	/** Whether this tick advanced the same schedule version it observed. */
	readonly outcome: ScheduleCursorAdvanceOutcomes;
}

/**
 * The only writer of a schedule's cursor, and it will not move one backwards.
 *
 * There is exactly one method and it is conditional by design: it updates the cursor only while the
 * schedule row still matches the version and previous cursor the caller observed. That is what makes
 * two schedulers, or a tick that overran, safe to run at the same time - the loser writes nothing
 * and reports `Stale` rather than rewinding the schedule.
 *
 * Called by: ScheduleTicker._advanceCursorIfNeeded in schedule-ticker.ts, through
 * {@link ScheduleTickerTransaction}.
 */
export interface ScheduleCursorRepository
{
	/** Performs the version-and-cursor compare-and-set without ever moving a newer cursor backwards. */
	advanceIfUnchanged(command: AdvanceScheduleCursorCommand): Promise<AdvanceScheduleCursorResult>;
}

/** The three persistence capabilities available for one short scheduler database operation. */
export interface ScheduleTickerTransaction
{
	/** Read-only enabled-schedule snapshots. */
	readonly schedules: EnabledScheduleSnapshotRepository;
	/** Read-only in-flight scheduled-run lookup. */
	readonly activeScheduledRuns: ActiveScheduledRunRepository;
	/** Write-only cursor compare-and-set authority. */
	readonly cursors: ScheduleCursorRepository;
}

/** Work performed only with capability repositories, never with a Prisma client. */
export type ScheduleTickerWork<Result> = (transaction: ScheduleTickerTransaction) => Promise<Result>;

/**
 * The scheduler's whole database boundary: short pieces of work, with no Prisma client in sight.
 *
 * Callers are handed capability repositories rather than a client, so the scheduler cannot reach
 * tables it does not own. Each `run` call is deliberately brief and happens either before or after
 * run admission, never around it - one tick therefore uses several small transactions instead of one
 * long one, because holding a transaction open across external admission calls would pin a
 * connection and invite deadlocks.
 *
 * Called by: ScheduleTicker in schedule-ticker.ts; implemented by PrismaScheduleTickerUnitOfWork
 * over a read-committed Prisma transaction and constructed in
 * apps/opencrane/src/app/background-workers.ts.
 */
export interface ScheduleTickerUnitOfWork
{
	/** Runs one short persistence operation against transaction-scoped capability repositories. */
	run<Result>(work: ScheduleTickerWork<Result>): Promise<Result>;
}

/** One processed schedule returned to the app-owned background-worker lifecycle. */
export interface ScheduleTickerResult
{
	/** Stable schedule identifier. */
	readonly scheduleId: string;
	/** Pure scheduling decision and its durable admission outcomes. */
	readonly result: ScheduleTickResult;
}
