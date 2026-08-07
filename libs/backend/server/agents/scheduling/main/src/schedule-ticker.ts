import type { ManagedRunAdmissionPort } from "@opencrane/backend/server/agents/agent-services";
import type { Logger } from "pino";

import { __RunScheduleTick } from "./schedule-tick.js";
import { ScheduleCursorAdvanceOutcomes, ScheduleTickStatuses } from "./schedule-tick.enums.js";
import type { ScheduleTickerResult, ScheduleTickerUnitOfWork } from "./schedule-ticker-unit-of-work.types.js";
import type { RetryBackoffPolicy, ScheduleTickResult } from "./schedule-tick.types.js";

/** Stable subject recorded as the requester of every scheduled admission. */
const _SCHEDULER_SUBJECT_ID = "system:scheduler";

/** Conservative delay policy reported when a transient admission refusal needs a later retry. */
const _DEFAULT_BACKOFF_POLICY: RetryBackoffPolicy = { baseDelayMs: 1_000, factor: 2, maxDelayMs: 60_000 };

/** Bounded number of missed slots a single schedule can process in one scheduler pass. */
const _MAX_SLOTS_PER_TICK = 60;

/** App-composed scheduler service that coordinates durable snapshots with the shared run-admission port. */
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

	/** Evaluates each enabled schedule at one trusted instant and records only version-fenced cursors. */
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

/** Composes the scheduler service without granting the composition root direct persistence operations. */
export function _CreateScheduleTicker(unitOfWork: ScheduleTickerUnitOfWork, admission: ManagedRunAdmissionPort, logger: Logger): ScheduleTicker
{
	return new ScheduleTicker(unitOfWork, admission, logger);
}
