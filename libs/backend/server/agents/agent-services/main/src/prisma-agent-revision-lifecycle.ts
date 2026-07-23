import { AgentRevisionState, AgentServiceKind, AgentServiceState, GrantScope, GrantSubjectType, Prisma, type PrismaClient } from "@prisma/client";

import type { GrantScope as DomainGrantScope, GrantSubjectType as DomainGrantSubjectType } from "@opencrane/models/agents";

import { __DigestCanonicalJson } from "@opencrane/backend/server/iam/authorization";
import type { JsonValue } from "@opencrane/util";

import type { AgentRevisionContent, AgentRevisionLifecycleRepository, AgentServiceHistory, AgentServiceLifecycleAction, AppendAgentRevisionResult, ChangeAgentServiceStateCommand, ChangeAgentServiceStateResult, CreateManagedAgentServiceCommand, CreateManagedAgentServiceResult, RestoreAgentRevisionCommand, ReviseAgentRevisionCommand } from "./agent-revision-lifecycle.types.js";
import type { AgentBudget } from "@opencrane/models/agents";

import { _grantScope, _grantSubjectType, _mapRevision, _mapRun, _mapService, _serviceState } from "./prisma-agent-mappers.js";

/** Include shape loading a revision with all immutable assignments and attachments. */
const _REVISION_INCLUDE = { skillAssignments: true, integrationAssignments: true, scopeAttachments: true } as const;

/** Maps a canonical scope value to the shared Prisma GrantScope enum. */
function _toPrismaScope(value: DomainGrantScope): GrantScope
{
	switch (value)
	{
		case "org": return GrantScope.Org;
		case "department": return GrantScope.Department;
		case "team": return GrantScope.Team;
		case "project": return GrantScope.Project;
		case "personal": return GrantScope.Personal;
		default: throw new Error(`unknown scope: ${value as string}`);
	}
}

/** Maps a canonical subject-type value to the shared Prisma GrantSubjectType enum. */
function _toPrismaSubjectType(value: DomainGrantSubjectType): GrantSubjectType
{
	switch (value)
	{
		case "group": return GrantSubjectType.Group;
		case "tenant": return GrantSubjectType.Tenant;
		case "user": return GrantSubjectType.User;
		default: throw new Error(`unknown subject type: ${value as string}`);
	}
}

/** Maps a lifecycle action to its target Prisma service state. */
function _targetServiceState(action: AgentServiceLifecycleAction): AgentServiceState
{
	if (action === "enable") return AgentServiceState.Active;
	if (action === "pause") return AgentServiceState.Paused;
	return AgentServiceState.Retired;
}

/** Computes the immutable per-revision content digest, unique within a service by revision number. */
function _revisionDigest(agentServiceId: string, revision: number, content: AgentRevisionContent): string
{
	const canonical: JsonValue = {
		agentServiceId,
		revision,
		promptPolicyVersion: content.promptPolicyVersion,
		personaRevisionId: content.personaRevisionId,
		modelDefinitionId: content.modelDefinitionId,
		budget: { maxTurns: content.budget.maxTurns, maxTokens: content.budget.maxTokens, maxDurationMs: content.budget.maxDurationMs },
		skills: content.skills.map(skill => ({ skillId: skill.skillId, revisionId: skill.revisionId })),
		integrationAssignments: content.integrationAssignments.map(assignment => ({ integrationId: assignment.integrationId, custodyReferenceId: assignment.custodyReferenceId, allowedTools: [...assignment.allowedTools] })),
		scopeAttachments: content.scopeAttachments.map(attachment => ({ scope: attachment.scope, subjectType: attachment.subjectType, subjectId: attachment.subjectId })),
	};
	return __DigestCanonicalJson(canonical);
}

/** Builds the nested create input for one immutable draft revision. */
function _revisionCreateData(agentServiceId: string, siloId: string, revision: number, parentRevisionId: string | null, sourceRevisionId: string | null, content: AgentRevisionContent, changeMessage: string, authoredBy: string, createdAt: Date): Prisma.AgentRevisionCreateInput
{
	return {
		agentService: { connect: { id: agentServiceId } },
		revision,
		parentRevision: parentRevisionId === null ? undefined : { connect: { id: parentRevisionId } },
		sourceRevision: sourceRevisionId === null ? undefined : { connect: { id: sourceRevisionId } },
		changeMessage,
		state: AgentRevisionState.Draft,
		digest: _revisionDigest(agentServiceId, revision, content),
		promptPolicyVersion: content.promptPolicyVersion,
		personaRevisionId: content.personaRevisionId,
		modelDefinition: { connect: { id: content.modelDefinitionId } },
		budget: { maxTurns: content.budget.maxTurns, maxTokens: content.budget.maxTokens, maxDurationMs: content.budget.maxDurationMs },
		authoredBy,
		createdAt,
		skillAssignments: { create: content.skills.map(skill => ({ skillId: skill.skillId, skillRevisionId: skill.revisionId })) },
		integrationAssignments: { create: content.integrationAssignments.map(assignment => ({ integrationId: assignment.integrationId, siloId, custodyReferenceId: assignment.custodyReferenceId, allowedTools: [...assignment.allowedTools] })) },
		scopeAttachments: { create: content.scopeAttachments.map(attachment => ({ scope: _toPrismaScope(attachment.scope), subjectType: _toPrismaSubjectType(attachment.subjectType), subjectId: attachment.subjectId })) },
	};
}

/** Projects an immutable revision's persisted content back into an authoring content command. */
function _contentFromRevision(row: { promptPolicyVersion: string; personaRevisionId: string | null; modelDefinitionId: string; budget: Prisma.JsonValue; skillAssignments: ReadonlyArray<{ skillId: string; skillRevisionId: string }>; integrationAssignments: ReadonlyArray<{ integrationId: string; custodyReferenceId: string; allowedTools: string[] }>; scopeAttachments: ReadonlyArray<{ scope: string; subjectType: string; subjectId: string }> }): AgentRevisionContent
{
	const budget = row.budget as unknown as AgentBudget;
	return {
		promptPolicyVersion: row.promptPolicyVersion,
		personaRevisionId: row.personaRevisionId,
		modelDefinitionId: row.modelDefinitionId,
		budget: { maxTurns: budget.maxTurns, maxTokens: budget.maxTokens, maxDurationMs: budget.maxDurationMs },
		skills: row.skillAssignments.map(assignment => ({ skillId: assignment.skillId, revisionId: assignment.skillRevisionId })),
		integrationAssignments: row.integrationAssignments.map(assignment => ({ integrationId: assignment.integrationId, custodyReferenceId: assignment.custodyReferenceId, allowedTools: [...assignment.allowedTools] })),
		scopeAttachments: row.scopeAttachments.map(attachment => ({ scope: _grantScope(attachment.scope), subjectType: _grantSubjectType(attachment.subjectType), subjectId: attachment.subjectId })),
	};
}

/** Returns whether a model definition is globally available or belongs to the service's tenant scope. */
async function _isModelDefinitionAvailable(transaction: Prisma.TransactionClient, modelDefinitionId: string, siloId: string): Promise<boolean>
{
	const definition = await transaction.modelDefinition.findUnique({ where: { id: modelDefinitionId }, select: { scope: true, clusterTenant: true } });
	return definition?.scope === "Global" || (definition?.scope === "ClusterTenant" && definition.clusterTenant === siloId);
}

/**
 * Prisma-backed authority for the managed-agent definition plane.
 *
 * Every mutation runs inside one transaction that locks the parent service first, so concurrent
 * edits either observe the same head revision or fail closed. Revisions are immutable: revise and
 * restore append a new draft rather than mutating an existing one, and restore records both the
 * lineage parent and the cloned source revision without touching history.
 */
export class PrismaAgentRevisionLifecycleRepository implements AgentRevisionLifecycleRepository
{
	/** OpenCrane product-authority database client. */
	private readonly prisma: PrismaClient;

	/**
	 * Creates a definition-plane repository over canonical Postgres.
	 * @param prisma - OpenCrane Prisma client.
	 */
	constructor(prisma: PrismaClient)
	{
		this.prisma = prisma;
	}

	/** Loads one stable service identity scoped to the caller's silo. */
	async getService(agentServiceId: string, siloId: string): Promise<Awaited<ReturnType<AgentRevisionLifecycleRepository["getService"]>>>
	{
		const row = await this.prisma.agentService.findFirst({ where: { id: agentServiceId, siloId } });
		return row === null ? null : _mapService(row);
	}

	/** Loads one immutable revision whose parent service is in the caller's silo. */
	async getRevision(agentRevisionId: string, siloId: string): Promise<Awaited<ReturnType<AgentRevisionLifecycleRepository["getRevision"]>>>
	{
		const row = await this.prisma.agentRevision.findFirst({ where: { id: agentRevisionId, agentService: { is: { siloId } } }, include: _REVISION_INCLUDE });
		return row === null ? null : _mapRevision(row);
	}

	/** Creates a managed service and its first immutable draft revision in one transaction. */
	async createManagedService(command: CreateManagedAgentServiceCommand, createdAt: string): Promise<CreateManagedAgentServiceResult>
	{
		const createdAtDate = new Date(createdAt);
		return this.prisma.$transaction(async function _create(transaction: Prisma.TransactionClient): Promise<CreateManagedAgentServiceResult>
		{
			if (!await _isModelDefinitionAvailable(transaction, command.content.modelDefinitionId, command.siloId)) return { outcome: "denied", reason: "model_definition_unavailable" };
			const serviceRow = await transaction.agentService.create({ data: { siloId: command.siloId, kind: AgentServiceKind.Managed, name: command.name, state: AgentServiceState.Draft, workloadProfile: command.workloadProfile, createdAt: createdAtDate, updatedAt: createdAtDate } });
			const revisionRow = await transaction.agentRevision.create({ data: _revisionCreateData(serviceRow.id, command.siloId, 1, null, null, command.content, command.changeMessage, command.authoredBy, createdAtDate), include: _REVISION_INCLUDE });
			return { outcome: "created", service: _mapService(serviceRow), revision: _mapRevision(revisionRow) };
		});
	}

	/** Appends a new draft revision editing the expected head under optimistic concurrency. */
	async reviseRevision(command: ReviseAgentRevisionCommand, createdAt: string): Promise<AppendAgentRevisionResult>
	{
		const createdAtDate = new Date(createdAt);
		return this.prisma.$transaction(async function _revise(transaction: Prisma.TransactionClient): Promise<AppendAgentRevisionResult>
		{
			const guard = await _lockAndReadHead(transaction, command.agentServiceId, command.siloId, command.expectedParentRevisionId);
			if (guard.outcome !== "ok") return guard.result;
			if (!await _isModelDefinitionAvailable(transaction, command.content.modelDefinitionId, guard.siloId)) return { outcome: "denied", reason: "model_definition_unavailable" };
			const revisionRow = await transaction.agentRevision.create({ data: _revisionCreateData(command.agentServiceId, guard.siloId, guard.head.revision + 1, guard.head.id, null, command.content, command.changeMessage, command.authoredBy, createdAtDate), include: _REVISION_INCLUDE });
			return { outcome: "revised", revision: _mapRevision(revisionRow) };
		});
	}

	/** Clones an older revision into a new draft revision under optimistic concurrency. */
	async restoreRevision(command: RestoreAgentRevisionCommand, createdAt: string): Promise<AppendAgentRevisionResult>
	{
		const createdAtDate = new Date(createdAt);
		return this.prisma.$transaction(async function _restore(transaction: Prisma.TransactionClient): Promise<AppendAgentRevisionResult>
		{
			const guard = await _lockAndReadHead(transaction, command.agentServiceId, command.siloId, command.expectedParentRevisionId);
			if (guard.outcome !== "ok") return guard.result;
			// Silo-scope the source lookup: a foreign-silo revision must be a 404, never a distinct 409
			// existence oracle. The same-silo different-service mismatch is still a 409 within the silo.
			const source = await transaction.agentRevision.findFirst({ where: { id: command.sourceRevisionId, agentService: { is: { siloId: command.siloId } } }, include: _REVISION_INCLUDE });
			if (source === null) return { outcome: "denied", reason: "revision_not_found" };
			if (source.agentServiceId !== command.agentServiceId) return { outcome: "denied", reason: "revision_service_mismatch" };
			const content = _contentFromRevision(source);
			const revisionRow = await transaction.agentRevision.create({ data: _revisionCreateData(command.agentServiceId, guard.siloId, guard.head.revision + 1, guard.head.id, source.id, content, command.changeMessage, command.authoredBy, createdAtDate), include: _REVISION_INCLUDE });
			return { outcome: "revised", revision: _mapRevision(revisionRow) };
		});
	}

	/** Changes one stable service state under optimistic concurrency in one transaction. */
	async changeServiceState(command: ChangeAgentServiceStateCommand, changedAt: string): Promise<ChangeAgentServiceStateResult>
	{
		const changedAtDate = new Date(changedAt);
		return this.prisma.$transaction(async function _change(transaction: Prisma.TransactionClient): Promise<ChangeAgentServiceStateResult>
		{
			await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "agent_services" WHERE "id" = ${command.agentServiceId} AND "silo_id" = ${command.siloId} FOR UPDATE`);
			const row = await transaction.agentService.findFirst({ where: { id: command.agentServiceId, siloId: command.siloId } });
			if (row === null) return { outcome: "denied", reason: "service_not_found" };
			if (_serviceState(row.state) !== command.expectedState) return { outcome: "conflict", currentState: _serviceState(row.state) };
			if (command.action === "enable" && row.activeRevisionId === null) return { outcome: "denied", reason: "service_not_runnable" };
			const updated = await transaction.agentService.update({ where: { id: command.agentServiceId }, data: { state: _targetServiceState(command.action), updatedAt: changedAtDate } });
			return { outcome: "changed", service: _mapService(updated) };
		});
	}

	/** Reads the silo-scoped revision lineage and durable run history for one service. */
	async readHistory(agentServiceId: string, siloId: string, runLimit: number): Promise<AgentServiceHistory>
	{
		const [revisions, runs] = await Promise.all([
			this.prisma.agentRevision.findMany({ where: { agentServiceId, agentService: { is: { siloId } } }, orderBy: { revision: "desc" }, include: _REVISION_INCLUDE }),
			this.prisma.agentRun.findMany({ where: { agentServiceId, siloId }, orderBy: { acceptedAt: "desc" }, take: Math.max(1, Math.min(runLimit, 200)) }),
		]);
		return { revisions: revisions.map(_mapRevision), runs: runs.map(_mapRun) };
	}
}

/** Guard result after locking a service and validating the expected head revision. */
type _HeadGuard =
	| { readonly outcome: "ok"; readonly siloId: string; readonly head: { id: string; revision: number } }
	| { readonly outcome: "blocked"; readonly result: AppendAgentRevisionResult };

/** Locks the silo-scoped service, then confirms the observed parent still matches the head revision. */
async function _lockAndReadHead(transaction: Prisma.TransactionClient, agentServiceId: string, siloId: string, expectedParentRevisionId: string | null): Promise<_HeadGuard>
{
	await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "agent_services" WHERE "id" = ${agentServiceId} AND "silo_id" = ${siloId} FOR UPDATE`);
	const service = await transaction.agentService.findFirst({ where: { id: agentServiceId, siloId } });
	// A service in another silo is indistinguishable from a missing one — no cross-silo existence oracle.
	if (service === null) return { outcome: "blocked", result: { outcome: "denied", reason: "service_not_found" } };
	if (_serviceState(service.state) === "retired") return { outcome: "blocked", result: { outcome: "denied", reason: "service_retired" } };
	const head = await transaction.agentRevision.findFirst({ where: { agentServiceId }, orderBy: { revision: "desc" }, select: { id: true, revision: true } });
	if (head === null || head.id !== expectedParentRevisionId) return { outcome: "blocked", result: { outcome: "conflict", currentHeadRevisionId: head?.id ?? null } };
	return { outcome: "ok", siloId: service.siloId, head };
}
