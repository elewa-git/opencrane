import type { AgentServiceSchedule, ScheduleTickResult } from "./schedule-tick.types.js";
import type { ScheduleCursorAdvanceOutcomes } from "./schedule-tick.enums.js";

/** One enabled scheduler snapshot read from one stable schedule version. */
export interface EnabledScheduleSnapshot
{
	/** Scheduler-owned schedule coordinates and evaluation policy. */
	readonly schedule: AgentServiceSchedule;
	/** Active managed revision observed with the schedule, or null when the service is not runnable. */
	readonly activeRevisionId: string | null;
	/** Exact persisted update instant used to fence the subsequent cursor compare-and-set. */
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

/** Command that conditionally records a completed scheduler tick's newest durable cursor. */
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

/** Capability repository that advances a schedule cursor only through its observed version. */
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

/** Opaque, scheduler-specific transaction boundary that exclusively owns Prisma. */
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
