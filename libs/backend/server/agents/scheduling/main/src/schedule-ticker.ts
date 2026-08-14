import type { ManagedRunAdmissionPort } from "@opencrane/backend/server/agents/agent-services";
import type { Logger } from "pino";

import { __RunScheduleTick } from "./schedule-tick";
import { ScheduleCursorAdvanceOutcomes, ScheduleTickStatuses } from "./schedule-tick.enums";
import type { ScheduleTickerResult, ScheduleTickerUnitOfWork } from "./schedule-ticker-unit-of-work.types";
import type { RetryBackoffPolicy, ScheduleTickResult } from "./schedule-tick.types";

/** Stable subject recorded as the requester of every scheduled admission. */
const _SCHEDULER_SUBJECT_ID = "system:scheduler";

/** Conservative delay policy reported when a transient admission refusal needs a later retry. */
const _DEFAULT_BACKOFF_POLICY: RetryBackoffPolicy = { baseDelayMs: 1_000, factor: 2, maxDelayMs: 60_000 };

/** Bounded number of missed slots a single schedule can process in one scheduler pass. */
const _MAX_SLOTS_PER_TICK = 60;

/**
 * Runs one pass over every enabled schedule and turns due slots into runs via the shared admission authority.
 *
 * One pass is: read all enabled schedules in a short transaction; then for each one work out what is
 * due and admit it; then try to record the cursor it reached. Admission happens outside any
 * transaction on purpose, so a slow admission call cannot hold a database connection - the price is
 * that the schedule can change underneath, which is why the cursor write is conditional and a
 * refusal is expected rather than an error. This class never creates an AgentRun itself and never
 * dispatches a Kubernetes Job; it only asks the run-admission authority.
 *
 * Safe to run in more than one process: each slot's idempotency key collapses concurrent ticks to a
 * single run, and the loser sees `Idempotent`.
 *
 * Called by: apps/opencrane/src/app/background-workers.ts, on an interval, built by
 * _CreateScheduleTicker.
 */
export class ScheduleTicker
{
	/** Opaque scheduling persistence boundary that exclusively owns Prisma transactions. */
	private readonly unitOfWork: ScheduleTickerUnitOfWork;
	/** Shared authority that is the only path allowed to create an AgentRun. */
	private readonly admission: ManagedRunAdmissionPort;
	/** Process logger for invalid persisted configuration and cursor races. */
	private readonly logger: Logger;

	/** Creates the scheduler service from opaque persistence and existing run-admission authorities. */
	constructor(unitOfWork: ScheduleTickerUnitOfWork, admission: ManagedRunAdmissionPort, logger: Logger)
	{
		this.unitOfWork = unitOfWork;
		this.admission = admission;
		this.logger = logger;
	}

	/**
	 * Do one pass over every enabled schedule at one instant.
	 *
	 * The instant is passed in rather than read here, so a whole pass shares one evaluation time and
	 * tests are deterministic. Schedules are handled one after another; one whose stored configuration
	 * is unusable is logged as a warning and reported, not thrown, so a single bad row cannot stop the
	 * rest of the pass. A cursor that could not be recorded is logged at debug and left to the next
	 * pass.
	 *
	 * @param now - The evaluation instant shared by every schedule in this pass.
	 * @returns One entry per enabled schedule, each with its schedule id and full tick result.
	 * @throws Errors from the database or the admission authority are not caught here and reach the caller.
	 */
	async runOnce(now: Date): Promise<readonly ScheduleTickerResult[]>
	{
		// 1. Snapshot enabled schedules briefly so no database transaction covers external run admission.
		const snapshots = await this.unitOfWork.run(async function _ListEnabled(transaction)
		{
			return transaction.schedules.listEnabledSnapshots();
		});
		const results: ScheduleTickerResult[] = [];
		for (const snapshot of snapshots)
		{
			// 2. Evaluate and admit through the only AgentRun authority; per-slot keys absorb concurrent ticks.
			const result = await __RunScheduleTick(snapshot.schedule, snapshot.activeRevisionId, {
				admission: this.admission,
				activeRuns: { hasActiveScheduledRun: this._hasActiveScheduledRun.bind(this) },
				clock: { now(): Date { return now; } },
				schedulerSubjectId: _SCHEDULER_SUBJECT_ID,
				maxSlotsPerTick: _MAX_SLOTS_PER_TICK,
				backoff: _DEFAULT_BACKOFF_POLICY,
			});

			// 3. CAS the cursor after admission, so a schedule edit or competing tick can never regress it.
			await this._advanceCursorIfNeeded(snapshot.schedule.id, snapshot.schedule.siloId, snapshot.updatedAt, snapshot.schedule.lastScheduledAt, result);
			if (result.status === ScheduleTickStatuses.InvalidSchedule)
			{
				this.logger.warn({ scheduleId: snapshot.schedule.id, reason: result.reason }, "skipping invalid managed-agent schedule");
			}
			results.push({ scheduleId: snapshot.schedule.id, result });
		}
		return results;
	}

	/** Looks up active scheduled work in its own short unit of work for the pure overlap decision. */
	private async _hasActiveScheduledRun(agentServiceId: string, siloId: string): Promise<boolean>
	{
		return this.unitOfWork.run(async function _FindActive(transaction)
		{
			return transaction.activeScheduledRuns.hasActiveScheduledRun(agentServiceId, siloId);
		});
	}

	/** Applies a completed result's cursor only when the same enabled schedule version is still current. */
	private async _advanceCursorIfNeeded(scheduleId: string, siloId: string, expectedUpdatedAt: string, expectedLastScheduledAt: string | null, result: ScheduleTickResult): Promise<void>
	{
		if (result.status !== ScheduleTickStatuses.Ticked || result.nextLastScheduledAt === null || result.nextLastScheduledAt === expectedLastScheduledAt) return;
		const nextLastScheduledAt = result.nextLastScheduledAt;
		const advancement = await this.unitOfWork.run(async function _AdvanceCursor(transaction)
		{
			return transaction.cursors.advanceIfUnchanged({ scheduleId, siloId, expectedUpdatedAt, expectedLastScheduledAt, nextLastScheduledAt });
		});
		if (advancement.outcome === ScheduleCursorAdvanceOutcomes.Stale) this.logger.debug({ scheduleId }, "managed-agent schedule cursor changed before tick completion");
	}
}

/**
 * Build the scheduler from its persistence boundary and the existing run-admission authority.
 *
 * Exists so the app's composition root never holds a Prisma client or any direct database
 * operation - it passes in the two authorities and gets back something with a single `runOnce`.
 *
 * Called by: apps/opencrane/src/app/background-workers.ts.
 *
 * @param unitOfWork - Scheduler-only database boundary; the only path to Prisma.
 * @param admission - The one authority allowed to create an AgentRun.
 * @param logger - Receives warnings for unusable schedules and debug lines for refused cursor writes.
 * @returns A ready scheduler; nothing runs until `runOnce` is called.
 */
export function _CreateScheduleTicker(unitOfWork: ScheduleTickerUnitOfWork, admission: ManagedRunAdmissionPort, logger: Logger): ScheduleTicker
{
	return new ScheduleTicker(unitOfWork, admission, logger);
}
