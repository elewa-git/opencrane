import { AgentRunState, AgentRunTrigger, AgentServiceKind, AgentServiceState, type PrismaClient } from "@prisma/client";
import type { Logger } from "pino";

import type { ManagedRunAdmissionPort } from "@opencrane/backend/server/agents/agent-services";

import { __RunScheduleTick } from "./schedule-tick.js";
import type { ActiveScheduledRunLookup, AgentServiceSchedule, RetryBackoffPolicy, ScheduleTickResult } from "./schedule-tick.types.js";
import type { ScheduleTicker } from "./prisma-schedule-ticker.types.js";

/** Non-terminal states that count as an in-flight scheduled run for overlap `skip`. */
const _ACTIVE_RUN_STATES = [AgentRunState.Accepted, AgentRunState.Queued, AgentRunState.Assigned, AgentRunState.Running, AgentRunState.WaitingForApproval, AgentRunState.Cancelling];

/** Stable subject recorded as the requester of every scheduled admission. */
const _SCHEDULER_SUBJECT = "system:scheduler";

/** Conservative delay policy for transiently unavailable admission. */
const _DEFAULT_BACKOFF: RetryBackoffPolicy = { baseDelayMs: 1_000, factor: 2, maxDelayMs: 60_000 };

/** Maximum missed slots one schedule catches up per pass. */
const _MAX_SLOTS_PER_TICK = 60;

/** Builds the Prisma-backed in-flight scheduled-run lookup used by overlap `skip`. */
function _createActiveScheduledRunLookup(prisma: PrismaClient): ActiveScheduledRunLookup
{
	return {
		async hasActiveScheduledRun(agentServiceId: string, siloId: string): Promise<boolean>
		{
			const count = await prisma.agentRun.count({ where: { agentServiceId, siloId, trigger: AgentRunTrigger.Schedule, state: { in: _ACTIVE_RUN_STATES } } });
			return count > 0;
		},
	};
}

/**
 * Composes the schedule ticker over canonical Postgres and shared admission.
 * @param prisma - Canonical product-authority client.
 * @param admission - Capacity-bounded admission port also used by run-now.
 * @param logger - Process logger supplied by the app composition root.
 * @returns A ticker whose `runOnce` performs one full scheduling pass.
 */
export function _CreateScheduleTicker(prisma: PrismaClient, admission: ManagedRunAdmissionPort, logger: Logger): ScheduleTicker
{
	const activeRuns = _createActiveScheduledRunLookup(prisma);
	return {
		async runOnce(now: Date): Promise<readonly { readonly scheduleId: string; readonly result: ScheduleTickResult }[]>
		{
			const rows = await prisma.agentServiceSchedule.findMany({ where: { enabled: true }, include: { service: { select: { kind: true, state: true, activeRevisionId: true } } } });
			const results: { scheduleId: string; result: ScheduleTickResult }[] = [];
			for (const row of rows)
			{
				const activeRevisionId = row.service.kind === AgentServiceKind.Managed && row.service.state === AgentServiceState.Active ? row.service.activeRevisionId : null;
				const schedule: AgentServiceSchedule = { id: row.id, siloId: row.siloId, agentServiceId: row.agentServiceId, cron: row.cron, timezone: row.timezone, overlapPolicy: row.overlapPolicy === "Allow" ? "allow" : "skip", enabled: row.enabled, catchupWindowSeconds: row.catchupWindowSeconds, lastScheduledAt: row.lastScheduledAt?.toISOString() ?? null };
				const result = await __RunScheduleTick(schedule, activeRevisionId, { admission, activeRuns, clock: { now(): Date { return now; } }, schedulerSubjectId: _SCHEDULER_SUBJECT, maxSlotsPerTick: _MAX_SLOTS_PER_TICK, backoff: _DEFAULT_BACKOFF });
				if (result.status === "ticked" && result.nextLastScheduledAt !== null && result.nextLastScheduledAt !== schedule.lastScheduledAt)
				{
					await prisma.agentServiceSchedule.update({ where: { id: row.id }, data: { lastScheduledAt: new Date(result.nextLastScheduledAt) } });
				}
				if (result.status === "invalid_schedule") logger.warn({ scheduleId: row.id, reason: result.reason }, "skipping invalid managed-agent schedule");
				results.push({ scheduleId: row.id, result });
			}
			return results;
		},
	};
}
