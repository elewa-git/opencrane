import { AgentRunState, AgentRunTrigger, AgentScheduleOverlapPolicy, AgentServiceKind, AgentServiceState, type Prisma } from "@prisma/client";

import { AgentScheduleOverlapPolicies } from "@opencrane/backend/server/agents/agent-services";

import { ScheduleCursorAdvanceOutcomes } from "./schedule-tick.enums.js";
import type { ActiveScheduledRunRepository, AdvanceScheduleCursorCommand, AdvanceScheduleCursorResult, EnabledScheduleSnapshot, EnabledScheduleSnapshotRepository, ScheduleCursorRepository } from "./schedule-ticker-unit-of-work.types.js";

/** Non-terminal states that count as an in-flight scheduled run for overlap skipping. */
const _ACTIVE_SCHEDULED_RUN_STATES = [AgentRunState.Accepted, AgentRunState.Queued, AgentRunState.Assigned, AgentRunState.Running, AgentRunState.WaitingForInput, AgentRunState.Cancelling];

/** Prisma row shape required to produce one version-fenced enabled schedule snapshot. */
interface _EnabledScheduleRow
{
	/** Stable schedule identifier. */
	readonly id: string;
	/** Silo that owns the schedule. */
	readonly siloId: string;
	/** Managed service that owns the schedule. */
	readonly agentServiceId: string;
	/** Persisted five-field cron expression. */
	readonly cron: string;
	/** Persisted IANA timezone. */
	readonly timezone: string;
	/** Prisma persistence enum for overlap policy. */
	readonly overlapPolicy: AgentScheduleOverlapPolicy;
	/** Whether the scheduler is allowed to evaluate the row. */
	readonly enabled: boolean;
	/** Bounded catch-up horizon. */
	readonly catchupWindowSeconds: number;
	/** Newest slot already processed. */
	readonly lastScheduledAt: Date | null;
	/** Optimistic concurrency version controlled by the schedule authority. */
	readonly updatedAt: Date;
	/** Service state read with the schedule. */
	readonly service: {
		/** Durable service kind. */
		readonly kind: AgentServiceKind;
		/** Durable lifecycle state. */
		readonly state: AgentServiceState;
		/** Active revision only when the service is runnable. */
		readonly activeRevisionId: string | null;
	};
}

/** Reads enabled schedule rows and converts them into scheduler-owned snapshots. */
export class PrismaEnabledScheduleSnapshotRepository implements EnabledScheduleSnapshotRepository
{
	/** Transaction-scoped database capability supplied exclusively by the schedule unit of work. */
	private readonly transaction: Prisma.TransactionClient;

	/** Creates the enabled-schedule snapshot repository. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/** Lists each enabled schedule with the service state needed to decide whether it is runnable. */
	async listEnabledSnapshots(): Promise<readonly EnabledScheduleSnapshot[]>
	{
		const rows = await this.transaction.agentServiceSchedule.findMany({
			where: { enabled: true },
			include: { service: { select: { kind: true, state: true, activeRevisionId: true } } },
		});
		return rows.map(function _MapEnabledSchedule(row): EnabledScheduleSnapshot
		{
			const scheduleRow = row as _EnabledScheduleRow;
			return {
				schedule: {
					id: scheduleRow.id,
					siloId: scheduleRow.siloId,
					agentServiceId: scheduleRow.agentServiceId,
					cron: scheduleRow.cron,
					timezone: scheduleRow.timezone,
					overlapPolicy: scheduleRow.overlapPolicy === AgentScheduleOverlapPolicy.Allow ? AgentScheduleOverlapPolicies.Allow : AgentScheduleOverlapPolicies.Skip,
					enabled: scheduleRow.enabled,
					catchupWindowSeconds: scheduleRow.catchupWindowSeconds,
					lastScheduledAt: scheduleRow.lastScheduledAt?.toISOString() ?? null,
				},
				activeRevisionId: scheduleRow.service.kind === AgentServiceKind.Managed && scheduleRow.service.state === AgentServiceState.Active ? scheduleRow.service.activeRevisionId : null,
				updatedAt: scheduleRow.updatedAt.toISOString(),
			};
		});
	}
}

/** Answers whether a service has a non-terminal scheduled run that blocks skip-overlap admission. */
export class PrismaActiveScheduledRunRepository implements ActiveScheduledRunRepository
{
	/** Transaction-scoped database capability supplied exclusively by the schedule unit of work. */
	private readonly transaction: Prisma.TransactionClient;

	/** Creates the active scheduled-run repository. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/** Counts in-flight scheduled runs inside the exact silo and managed-service coordinates. */
	async hasActiveScheduledRun(agentServiceId: string, siloId: string): Promise<boolean>
	{
		const count = await this.transaction.agentRun.count({
			where: {
				agentServiceId,
				siloId,
				trigger: AgentRunTrigger.Schedule,
				state: { in: _ACTIVE_SCHEDULED_RUN_STATES },
			},
		});
		return count > 0;
	}
}

/** Advances the scheduler cursor only when the exact pre-admission schedule version still exists. */
export class PrismaScheduleCursorRepository implements ScheduleCursorRepository
{
	/** Transaction-scoped database capability supplied exclusively by the schedule unit of work. */
	private readonly transaction: Prisma.TransactionClient;

	/** Creates the version-fenced schedule cursor repository. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/** Updates the cursor with a version-and-previous-cursor compare-and-set. */
	async advanceIfUnchanged(command: AdvanceScheduleCursorCommand): Promise<AdvanceScheduleCursorResult>
	{
		const advanced = await this.transaction.agentServiceSchedule.updateMany({
			where: {
				id: command.scheduleId,
				siloId: command.siloId,
				enabled: true,
				updatedAt: new Date(command.expectedUpdatedAt),
				lastScheduledAt: command.expectedLastScheduledAt === null ? null : new Date(command.expectedLastScheduledAt),
			},
			data: { lastScheduledAt: new Date(command.nextLastScheduledAt) },
		});
		return { outcome: advanced.count === 1 ? ScheduleCursorAdvanceOutcomes.Advanced : ScheduleCursorAdvanceOutcomes.Stale };
	}
}
