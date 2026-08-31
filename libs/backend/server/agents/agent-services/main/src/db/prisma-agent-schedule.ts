import { AgentScheduleOverlapPolicy as PrismaOverlapPolicy, AgentServiceKind, Prisma, type PrismaClient } from "@prisma/client";

import { AgentScheduleOverlapPolicies, type AgentScheduleDeletionResult, type AgentScheduleMutationResult, type AgentScheduleOverlapPolicy, type AgentScheduleRepository, type AgentServiceScheduleRecord, type CreateAgentScheduleCommand, type UpdateAgentScheduleCommand } from "../agent-schedule.types";
import { PrismaAuthorizationAuthority, PrismaManagedAuthorizationGrantRepository, type AuthorizationAuthority, type ManagedAuthorizationGrantRepository, type ManagedAuthorizationGrantSpec } from "@opencrane/backend/server/iam/authorization";
import { AuthorizationBoundaryCoverages, AuthorizationBoundaryKinds, AuthorizationDecisionOutcomes, AuthorizationSubjectKinds, ProductAuthorizationActions, ProductAuthorizationResourceKinds, __ProductAuthorizationCapability, type ProductAuthorizationResourceLocator } from "@opencrane/models/authorization";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

/** Isolates grants written for the Principal that created a schedule item. */
const _SCHEDULE_CREATOR_GRANT_MANAGER_ID = "agent-schedule-creator-bootstrap";

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
	/** Transaction that owns the schedule decision and mutation. */
	private readonly prisma: Prisma.TransactionClient;
	/** Central authority bound to the same schedule transaction. */
	private readonly authorization: Pick<AuthorizationAuthority, "admitPrincipal" | "listPrincipalEntitled">;
	/** Reconciles schedule creator grants within the same transaction. */
	private readonly grantWriter: ManagedAuthorizationGrantRepository;

	/**
	 * Creates a schedule repository over canonical Postgres.
	 * @param prisma - OpenCrane Prisma client.
	 */
	constructor(prisma: Prisma.TransactionClient, authorization: Pick<AuthorizationAuthority, "admitPrincipal" | "listPrincipalEntitled">)
	{
		this.prisma = prisma;
		this.authorization = authorization;
		this.grantWriter = new PrismaManagedAuthorizationGrantRepository(this.prisma);
	}

	/** Creates one schedule for a managed service in the caller's silo. */
	async createSchedule(command: CreateAgentScheduleCommand, createdAt: string): Promise<AgentScheduleMutationResult>
	{
		const createdAtDate = new Date(createdAt);
		const service = await this.prisma.agentService.findFirst({ where: { id: command.agentServiceId, siloId: command.siloId }, select: { kind: true } });
		if (service === null)
			return { outcome: "denied", reason: "service_not_found" };
		if (service.kind !== AgentServiceKind.Managed)
			return { outcome: "denied", reason: "service_not_managed" };
		if (!await _AdmitScheduleMutation(this.authorization, command.siloId, command.principalId, command.agentServiceId, ProductAuthorizationActions.Create, { operation: "create-schedule", agentServiceId: command.agentServiceId }, createdAtDate.getTime()))
			return { outcome: "denied", reason: "unauthorized" };
		const row = await this.prisma.agentServiceSchedule.create({ data: { siloId: command.siloId, agentServiceId: command.agentServiceId, cron: command.cron, timezone: command.timezone, overlapPolicy: _toPrismaOverlap(command.overlapPolicy), enabled: command.enabled, catchupWindowSeconds: command.catchupWindowSeconds, createdAt: createdAtDate, updatedAt: createdAtDate } });
		await _SeedScheduleItemGrants(this.grantWriter, command.siloId, command.principalId, row.id, createdAtDate);
		return { outcome: "ok", schedule: _mapSchedule(row as _ScheduleRow) };
	}

	/** Updates one schedule's mutable fields, silo-scoped. */
	async updateSchedule(command: UpdateAgentScheduleCommand, updatedAt: string): Promise<AgentScheduleMutationResult>
	{
		const updatedAtDate = new Date(updatedAt);
		const existing = await this.prisma.agentServiceSchedule.findFirst({ where: { id: command.scheduleId, siloId: command.siloId, agentServiceId: command.agentServiceId }, select: { id: true } });
		if (existing === null)
			return { outcome: "denied", reason: "schedule_not_found" };
		if (!await _AdmitScheduleMutation(this.authorization, command.siloId, command.principalId, command.scheduleId, ProductAuthorizationActions.Edit, { operation: "update-schedule", agentServiceId: command.agentServiceId, scheduleId: command.scheduleId }, updatedAtDate.getTime()))
			return { outcome: "denied", reason: "unauthorized" };
		const row = await this.prisma.agentServiceSchedule.update({ where: { id: command.scheduleId }, data: { cron: command.cron, timezone: command.timezone, overlapPolicy: _toPrismaOverlap(command.overlapPolicy), enabled: command.enabled, catchupWindowSeconds: command.catchupWindowSeconds, updatedAt: updatedAtDate } });
		return { outcome: "ok", schedule: _mapSchedule(row as _ScheduleRow) };
	}

	/** Deletes one schedule, silo-scoped. */
	async deleteSchedule(command: { readonly principalId: string; readonly agentServiceId: string; readonly scheduleId: string; readonly siloId: string }, deletedAt: string): Promise<AgentScheduleDeletionResult>
	{
		const existing = await this.prisma.agentServiceSchedule.findFirst({ where: { id: command.scheduleId, siloId: command.siloId, agentServiceId: command.agentServiceId }, select: { id: true } });
		if (existing === null)
			return { outcome: "denied", reason: "schedule_not_found" };
		if (!await _AdmitScheduleMutation(this.authorization, command.siloId, command.principalId, command.scheduleId, ProductAuthorizationActions.Delete, { operation: "delete-schedule", agentServiceId: command.agentServiceId, scheduleId: command.scheduleId }, Date.parse(deletedAt)))
			return { outcome: "denied", reason: "unauthorized" };
		await this.prisma.agentServiceSchedule.delete({ where: { id: command.scheduleId } });
		return { outcome: "deleted" };
	}

	/** Lists the schedules of one service, silo-scoped. */
	async listSchedules(agentServiceId: string, caller: { readonly principalId: string; readonly siloId: string }): Promise<readonly AgentServiceScheduleRecord[]>
	{
		const rows = await this.prisma.agentServiceSchedule.findMany({ where: { agentServiceId, siloId: caller.siloId }, orderBy: { createdAt: "asc" } });
		const entitled = await this.authorization.listPrincipalEntitled({ siloId: caller.siloId, principalId: caller.principalId, action: ProductAuthorizationActions.Read, resources: rows.map(row => ({ kind: ProductAuthorizationResourceKinds.Schedule, id: row.id })), nowEpochMs: Date.now() });
		const entitledIds = new Set(entitled.map(resource => resource.id));
		return rows.filter(row => entitledIds.has(row.id)).map(row => _mapSchedule(row as _ScheduleRow));
	}
}

/** Opens the transaction that keeps each schedule decision and write atomic. */
export class PrismaAgentScheduleUnitOfWork implements AgentScheduleRepository
{
	/** OpenCrane product-authority database client. */
	private readonly prisma: PrismaClient;
	/** Test seam that returns an authority bound to the supplied transaction. */
	private readonly createAuthorization: ((transaction: Prisma.TransactionClient) => Pick<AuthorizationAuthority, "admitPrincipal" | "listPrincipalEntitled">) | null;

	/** Creates the schedule unit of work over canonical Postgres. */
	constructor(prisma: PrismaClient, createAuthorization: ((transaction: Prisma.TransactionClient) => Pick<AuthorizationAuthority, "admitPrincipal" | "listPrincipalEntitled">) | null = null)
	{
		this.prisma = prisma;
		this.createAuthorization = createAuthorization;
	}

	createSchedule(command: CreateAgentScheduleCommand, createdAt: string): Promise<AgentScheduleMutationResult> { return this._Run(function _Create(repository) { return repository.createSchedule(command, createdAt); }); }
	updateSchedule(command: UpdateAgentScheduleCommand, updatedAt: string): Promise<AgentScheduleMutationResult> { return this._Run(function _Update(repository) { return repository.updateSchedule(command, updatedAt); }); }
	deleteSchedule(command: { readonly principalId: string; readonly agentServiceId: string; readonly scheduleId: string; readonly siloId: string }, deletedAt: string): Promise<AgentScheduleDeletionResult> { return this._Run(function _Delete(repository) { return repository.deleteSchedule(command, deletedAt); }); }
	listSchedules(agentServiceId: string, caller: { readonly principalId: string; readonly siloId: string }): Promise<readonly AgentServiceScheduleRecord[]> { return this._Run(function _List(repository) { return repository.listSchedules(agentServiceId, caller); }); }

	/** Runs one schedule operation inside one serializable transaction. */
	private _Run<TResult>(operation: (repository: PrismaAgentScheduleRepository) => Promise<TResult>): Promise<TResult>
	{
		const createAuthorization = this.createAuthorization;
		return this.prisma.$transaction(async function _Run(transaction: Prisma.TransactionClient)
		{
			const authorization = createAuthorization === null ? new PrismaAuthorizationAuthority(transaction) : createAuthorization(transaction);
			return operation(new PrismaAgentScheduleRepository(transaction, authorization));
		}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
	}
}

/** Requires the exact collection or item schedule grant in the write transaction. */
async function _AdmitScheduleMutation(authorization: Pick<AuthorizationAuthority, "admitPrincipal">, siloId: string, principalId: string, resourceId: string, action: ProductAuthorizationActions, argumentsValue: JsonValue, nowEpochMs: number): Promise<boolean>
{
	const admission = await authorization.admitPrincipal({ siloId, principalId, actorKind: "user", actorId: principalId, resource: { kind: ProductAuthorizationResourceKinds.Schedule, id: resourceId }, action, argumentsDigest: ___DigestCanonicalJson(argumentsValue), nowEpochMs });
	return admission.outcome === AuthorizationDecisionOutcomes.Allow;
}

/** Seeds exact read and mutation grants for the newly created schedule item. */
async function _SeedScheduleItemGrants(grantWriter: ManagedAuthorizationGrantRepository, siloId: string, principalId: string, scheduleId: string, now: Date): Promise<void>
{
	const resource: ProductAuthorizationResourceLocator = { kind: ProductAuthorizationResourceKinds.Schedule, id: scheduleId };
	const grants: ManagedAuthorizationGrantSpec[] = [ProductAuthorizationActions.Read, ProductAuthorizationActions.Edit, ProductAuthorizationActions.Delete].map(function _Grant(action): ManagedAuthorizationGrantSpec
	{
		const capability = __ProductAuthorizationCapability(resource.kind, action);
		if (capability === null)
			throw new Error(`schedule creator grant capability is missing for ${action}`);
		return { subject: { kind: AuthorizationSubjectKinds.Principal, principalId }, boundary: { kind: AuthorizationBoundaryKinds.Personal, principalId }, boundaryCoverage: AuthorizationBoundaryCoverages.Exact, capability, resource, priority: 0, createdByPrincipalId: principalId };
	});
	await grantWriter.reconcileManagedResourceGrants({ siloId, managerId: _SCHEDULE_CREATOR_GRANT_MANAGER_ID, resource, grants, now });
}
