import { AgentScheduleOverlapPolicy as PrismaOverlapPolicy, AgentServiceKind, type PrismaClient } from "@prisma/client";

import { AgentScheduleOverlapPolicies, type AgentScheduleDeletionResult, type AgentScheduleMutationResult, type AgentScheduleOverlapPolicy, type AgentScheduleRepository, type AgentServiceScheduleRecord, type CreateAgentScheduleCommand, type UpdateAgentScheduleCommand } from "./agent-schedule.types";

/** Row shape read back from Postgres for one schedule. */
interface _ScheduleRow
{
	id: string;
	siloId: string;
	agentServiceId: string;
	cron: string;
	timezone: string;
	overlapPolicy: PrismaOverlapPolicy;
	enabled: boolean;
	catchupWindowSeconds: number;
	lastScheduledAt: Date | null;
	createdAt: Date;
	updatedAt: Date;
}

/** Maps the domain overlap policy to the Prisma enum. */
function _toPrismaOverlap(value: AgentScheduleOverlapPolicy): PrismaOverlapPolicy
{
	return value === AgentScheduleOverlapPolicies.Allow ? PrismaOverlapPolicy.Allow : PrismaOverlapPolicy.Skip;
}

/** Maps the Prisma overlap enum to the domain value. */
function _fromPrismaOverlap(value: PrismaOverlapPolicy): AgentScheduleOverlapPolicy
{
	return value === PrismaOverlapPolicy.Allow ? AgentScheduleOverlapPolicies.Allow : AgentScheduleOverlapPolicies.Skip;
}

/** Maps one Prisma schedule row to the dependency-light record. */
function _mapSchedule(row: _ScheduleRow): AgentServiceScheduleRecord
{
	return {
		id: row.id,
		siloId: row.siloId,
		agentServiceId: row.agentServiceId,
		cron: row.cron,
		timezone: row.timezone,
		overlapPolicy: _fromPrismaOverlap(row.overlapPolicy),
		enabled: row.enabled,
		catchupWindowSeconds: row.catchupWindowSeconds,
		lastScheduledAt: row.lastScheduledAt?.toISOString() ?? null,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}

/**
 * Prisma-backed schedule authority for the managed-agent plane.
 *
 * Every mutation is silo-scoped and confirms the target service exists, is in the caller's silo, and
 * is managed before touching a schedule row; a service in another silo is indistinguishable from a
 * missing one, so there is no cross-silo existence oracle.
 */
export class PrismaAgentScheduleRepository implements AgentScheduleRepository
{
	/** OpenCrane product-authority database client. */
	private readonly prisma: PrismaClient;

	/**
	 * Creates a schedule repository over canonical Postgres.
	 * @param prisma - OpenCrane Prisma client.
	 */
	constructor(prisma: PrismaClient)
	{
		this.prisma = prisma;
	}

	/** Creates one schedule for a managed service in the caller's silo. */
	async createSchedule(command: CreateAgentScheduleCommand, createdAt: string): Promise<AgentScheduleMutationResult>
	{
		const createdAtDate = new Date(createdAt);
		return this.prisma.$transaction(async (transaction): Promise<AgentScheduleMutationResult> => {
			const service = await transaction.agentService.findFirst({ where: { id: command.agentServiceId, siloId: command.siloId }, select: { kind: true } });
			if (service === null) return { outcome: "denied", reason: "service_not_found" };
			if (service.kind !== AgentServiceKind.Managed) return { outcome: "denied", reason: "service_not_managed" };
			const row = await transaction.agentServiceSchedule.create({ data: { siloId: command.siloId, agentServiceId: command.agentServiceId, cron: command.cron, timezone: command.timezone, overlapPolicy: _toPrismaOverlap(command.overlapPolicy), enabled: command.enabled, catchupWindowSeconds: command.catchupWindowSeconds, createdAt: createdAtDate, updatedAt: createdAtDate } });
			return { outcome: "ok", schedule: _mapSchedule(row as _ScheduleRow) };
		});
	}

	/** Updates one schedule's mutable fields, silo-scoped. */
	async updateSchedule(command: UpdateAgentScheduleCommand, updatedAt: string): Promise<AgentScheduleMutationResult>
	{
		const updatedAtDate = new Date(updatedAt);
		return this.prisma.$transaction(async (transaction): Promise<AgentScheduleMutationResult> => {
			const existing = await transaction.agentServiceSchedule.findFirst({ where: { id: command.scheduleId, siloId: command.siloId, agentServiceId: command.agentServiceId }, select: { id: true } });
			if (existing === null) return { outcome: "denied", reason: "schedule_not_found" };
			const row = await transaction.agentServiceSchedule.update({ where: { id: command.scheduleId }, data: { cron: command.cron, timezone: command.timezone, overlapPolicy: _toPrismaOverlap(command.overlapPolicy), enabled: command.enabled, catchupWindowSeconds: command.catchupWindowSeconds, updatedAt: updatedAtDate } });
			return { outcome: "ok", schedule: _mapSchedule(row as _ScheduleRow) };
		});
	}

	/** Deletes one schedule, silo-scoped. */
	async deleteSchedule(agentServiceId: string, scheduleId: string, siloId: string): Promise<AgentScheduleDeletionResult>
	{
		return this.prisma.$transaction(async (transaction): Promise<AgentScheduleDeletionResult> => {
			const existing = await transaction.agentServiceSchedule.findFirst({ where: { id: scheduleId, siloId, agentServiceId }, select: { id: true } });
			if (existing === null) return { outcome: "denied", reason: "schedule_not_found" };
			await transaction.agentServiceSchedule.delete({ where: { id: scheduleId } });
			return { outcome: "deleted" };
		});
	}

	/** Lists the schedules of one service, silo-scoped. */
	async listSchedules(agentServiceId: string, siloId: string): Promise<readonly AgentServiceScheduleRecord[]>
	{
		const rows = await this.prisma.agentServiceSchedule.findMany({ where: { agentServiceId, siloId }, orderBy: { createdAt: "asc" } });
		return rows.map(row => _mapSchedule(row as _ScheduleRow));
	}
}
