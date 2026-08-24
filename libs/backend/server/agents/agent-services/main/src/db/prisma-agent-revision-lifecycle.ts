import { randomUUID } from "node:crypto";

import { AgentServiceKind, AgentServiceState, Prisma, type PrismaClient } from "@prisma/client";

import type { AgentService } from "@opencrane/models/agents";

import type { AgentRevisionLifecycleRepository, AgentServiceHistory, AgentServiceLifecycleAction, AppendAgentRevisionResult, ChangeAgentServiceStateCommand, ChangeAgentServiceStateResult, CreateManagedAgentServiceCommand, CreateManagedAgentServiceResult, RestoreAgentRevisionCommand, ReviseAgentRevisionCommand } from "../agent-revision-lifecycle.types";

import { _mapRevision, _mapRun, _mapService, _serviceState } from "./prisma-agent-mappers";
import { _AGENT_REVISION_INCLUDE, _AgentRevisionContentFromRow, PrismaAgentRevisionWriterRepository } from "./prisma-agent-revision-writer";
import { __CreateManagedAgentServicePrincipalRepository } from "./prisma-managed-agent-service-principal.factory";

/** Maps a lifecycle action to its target Prisma service state. */
function _targetServiceState(action: AgentServiceLifecycleAction): AgentServiceState
{
	if (action === "enable")
		return AgentServiceState.Active;
	if (action === "pause")
		return AgentServiceState.Paused;
	return AgentServiceState.Retired;
}

/** Returns whether a model definition is globally available or belongs to the service's tenant scope. */
async function _isModelDefinitionAvailable(transaction: Prisma.TransactionClient, modelDefinitionId: string, siloId: string): Promise<boolean>
{
	const definition = await transaction.modelDefinition.findUnique({ where: { id: modelDefinitionId }, select: { scope: true, clusterTenant: true } });
	return definition?.scope === "Global" || (definition?.scope === "ClusterTenant" && definition.clusterTenant === siloId);
}

/**
 * Stores managed-agent services and revisions in Postgres.
 *
 * Every write runs in one transaction that takes a row lock on the parent service first, so two
 * concurrent edits queue rather than race: the second one sees the first one's revision and returns
 * a conflict instead of overwriting it.
 *
 * Revisions are never edited or deleted. Revise adds a new draft; restore adds a new draft that
 * copies an older revision's content and records both its lineage parent and the revision it was
 * copied from, so the history stays complete.
 *
 * Called by: constructed in `prisma-agent-services.router.ts` and passed to the router as
 * `lifecycle`.
 * NEEDS-HUMAN: the row lock is PostgreSQL `SELECT … FOR UPDATE`; add the doc URI for the Postgres
 * major version this deployment pins.
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

	/** List the newest two hundred managed service identities from one exact silo. */
	async listManagedServices(siloId: string): Promise<readonly AgentService[]>
	{
		const rows = await this.prisma.agentService.findMany({ where: { siloId, kind: AgentServiceKind.Managed }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: 200 });
		return rows.map(_mapService);
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
		const row = await this.prisma.agentRevision.findFirst({ where: { id: agentRevisionId, agentService: { is: { siloId } } }, include: _AGENT_REVISION_INCLUDE });
		return row === null ? null : _mapRevision(row);
	}

	/** Creates a managed service and its first immutable draft revision in one transaction. */
	async createManagedService(command: CreateManagedAgentServiceCommand, createdAt: string): Promise<CreateManagedAgentServiceResult>
	{
		const createdAtDate = new Date(createdAt);
		return this.prisma.$transaction(async function _create(transaction: Prisma.TransactionClient): Promise<CreateManagedAgentServiceResult>
		{
			if (!await _isModelDefinitionAvailable(transaction, command.content.modelDefinitionId, command.siloId))
				return { outcome: "denied", reason: "model_definition_unavailable" };
			const agentServiceId = randomUUID();
			const principalId = await __CreateManagedAgentServicePrincipalRepository(transaction).create(command.siloId, agentServiceId, command.name, createdAtDate);
			const serviceRow = await transaction.agentService.create({ data: { id: agentServiceId, siloId: command.siloId, kind: AgentServiceKind.Managed, name: command.name, state: AgentServiceState.Draft, workloadProfile: command.workloadProfile, principalId, createdAt: createdAtDate, updatedAt: createdAtDate } });
			const revisionRow = await new PrismaAgentRevisionWriterRepository(transaction).createDraft({
				siloId: command.siloId,
				agentServiceId: serviceRow.id,
				revision: 1,
				parentRevisionId: null,
				sourceRevisionId: null,
				content: command.content,
				changeMessage: command.changeMessage,
				authoredBy: command.authoredBy,
				createdAt: createdAtDate,
			});
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
			if (guard.outcome !== "ok")
				return guard.result;
			if (!await _isModelDefinitionAvailable(transaction, command.content.modelDefinitionId, guard.siloId))
				return { outcome: "denied", reason: "model_definition_unavailable" };
			const revisionRow = await new PrismaAgentRevisionWriterRepository(transaction).createDraft({
				siloId: guard.siloId,
				agentServiceId: command.agentServiceId,
				revision: guard.head.revision + 1,
				parentRevisionId: guard.head.id,
				sourceRevisionId: null,
				content: command.content,
				changeMessage: command.changeMessage,
				authoredBy: command.authoredBy,
				createdAt: createdAtDate,
			});
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
			if (guard.outcome !== "ok")
				return guard.result;
			// Silo-scope the source lookup: a foreign-silo revision must be a 404, never a distinct 409
			// existence oracle. The same-silo different-service mismatch is still a 409 within the silo.
			const source = await transaction.agentRevision.findFirst({ where: { id: command.sourceRevisionId, agentService: { is: { siloId: command.siloId } } }, include: _AGENT_REVISION_INCLUDE });
			if (source === null)
				return { outcome: "denied", reason: "revision_not_found" };
			if (source.agentServiceId !== command.agentServiceId)
				return { outcome: "denied", reason: "revision_service_mismatch" };
			const content = _AgentRevisionContentFromRow(source);
			const revisionRow = await new PrismaAgentRevisionWriterRepository(transaction).createDraft({
				siloId: guard.siloId,
				agentServiceId: command.agentServiceId,
				revision: guard.head.revision + 1,
				parentRevisionId: guard.head.id,
				sourceRevisionId: source.id,
				content,
				changeMessage: command.changeMessage,
				authoredBy: command.authoredBy,
				createdAt: createdAtDate,
			});
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
			if (row === null)
				return { outcome: "denied", reason: "service_not_found" };
			if (_serviceState(row.state) !== command.expectedState)
				return { outcome: "conflict", currentState: _serviceState(row.state) };
			if (command.action === "enable" && row.activeRevisionId === null)
				return { outcome: "denied", reason: "service_not_runnable" };
			const updated = await transaction.agentService.update({
				where: { id: command.agentServiceId },
				data: {
					state: _targetServiceState(command.action),
					activeRevisionId: command.action === "retire" ? null : undefined,
					updatedAt: changedAtDate,
				},
			});
			return { outcome: "changed", service: _mapService(updated) };
		});
	}

	/** Reads the silo-scoped revision lineage and durable run history for one service. */
	async readHistory(agentServiceId: string, siloId: string, runLimit: number): Promise<AgentServiceHistory>
	{
		const [revisions, runs] = await Promise.all([
			this.prisma.agentRevision.findMany({ where: { agentServiceId, agentService: { is: { siloId } } }, orderBy: { revision: "desc" }, include: _AGENT_REVISION_INCLUDE }),
			this.prisma.agentRun.findMany({ where: { agentServiceId, siloId }, orderBy: { acceptedAt: "desc" }, take: Math.max(1, Math.min(runLimit, 200)) }),
		]);
		return { revisions: revisions.map(_mapRevision), runs: runs.map(_mapRun) };
	}
}

/** Guard result after locking a service and validating the expected head revision. */
type _HeadGuard =
	| { readonly outcome: "ok"; readonly siloId: string; readonly head: { id: string; revision: number } }
	| { readonly outcome: "blocked"; readonly result: AppendAgentRevisionResult };

/**
 * Locks the service row, then checks the caller is editing the newest revision.
 *
 * Returns `blocked` for three cases the caller must not proceed past: the service is missing (or in
 * another silo — indistinguishable on purpose), the service is retired, or the newest stored revision
 * is not the one the caller said they edited. The last case returns the current newest revision id so
 * the caller can re-apply its edit on top of it.
 */
async function _lockAndReadHead(transaction: Prisma.TransactionClient, agentServiceId: string, siloId: string, expectedParentRevisionId: string | null): Promise<_HeadGuard>
{
	await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "agent_services" WHERE "id" = ${agentServiceId} AND "silo_id" = ${siloId} FOR UPDATE`);
	const service = await transaction.agentService.findFirst({ where: { id: agentServiceId, siloId } });
	// A service in another silo is indistinguishable from a missing one — no cross-silo existence oracle.
	if (service === null)
		return { outcome: "blocked", result: { outcome: "denied", reason: "service_not_found" } };
	if (_serviceState(service.state) === "retired")
		return { outcome: "blocked", result: { outcome: "denied", reason: "service_retired" } };
	const head = await transaction.agentRevision.findFirst({ where: { agentServiceId }, orderBy: { revision: "desc" }, select: { id: true, revision: true } });
	if (head === null || head.id !== expectedParentRevisionId)
		return { outcome: "blocked", result: { outcome: "conflict", currentHeadRevisionId: head?.id ?? null } };
	return { outcome: "ok", siloId: service.siloId, head };
}
