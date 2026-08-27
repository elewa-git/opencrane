import { randomUUID } from "node:crypto";

import { AgentServiceKind, AgentServiceState, ModelRoutingScope, Prisma, type PrismaClient } from "@prisma/client";

import { AgentServiceStates, type AgentService } from "@opencrane/models/agents";

import { AgentRevisionLifecycleDenials, AgentServiceLifecycleActions } from "../agent-revision-lifecycle.types";
import type { AgentRevisionLifecycleRepository, AgentServiceHistory, AgentServiceLifecycleAction, AppendAgentRevisionResult, ChangeAgentServiceStateCommand, ChangeAgentServiceStateResult, CreateManagedAgentServiceCommand, CreateManagedAgentServiceResult, RestoreAgentRevisionCommand, ReviseAgentRevisionCommand } from "../agent-revision-lifecycle.types";

import { _mapRevision, _mapRun, _mapService, _serviceState } from "./prisma-agent-mappers";
import { _AGENT_REVISION_INCLUDE, _AgentRevisionContentFromRow, PrismaAgentRevisionWriterRepository } from "./prisma-agent-revision-writer";
import { __CreateManagedAgentServicePrincipalRepository } from "./prisma-managed-agent-service-principal.factory";

/** Maps a lifecycle action to its target Prisma service state. */
function _targetServiceState(action: AgentServiceLifecycleAction): AgentServiceState
{
	if (action === AgentServiceLifecycleActions.Enable)
		return AgentServiceState.Active;
	if (action === AgentServiceLifecycleActions.Pause)
		return AgentServiceState.Paused;
	return AgentServiceState.Retired;
}

/** Names the results returned through the lifecycle contract. */
const _LifecycleOutcomes = Object.freeze({
	/** Reports that the repository created the service and its first revision. */
	Created: "created",
	/** Reports that the repository refused the operation and included a reason. */
	Denied: "denied",
	/** Reports that the repository appended a new revision. */
	Revised: "revised",
	/** Reports that another writer changed the expected state first. */
	Conflict: "conflict",
	/** Reports that the repository changed the managed service state. */
	Changed: "changed",
} as const);

/** Names whether a claimed service may receive a new revision. */
enum _HeadGuardOutcomes
{
	/** Allows the caller to append after it reads the current head. */
	Ready = "ready",
	/** Stops the caller because service ownership or lineage validation failed. */
	Blocked = "blocked",
}

/** Guard result after claiming a service and validating the expected head revision. */
type _HeadGuard =
	| { readonly outcome: _HeadGuardOutcomes.Ready; readonly siloId: string; readonly head: { id: string; revision: number } }
	| { readonly outcome: _HeadGuardOutcomes.Blocked; readonly result: AppendAgentRevisionResult };

/**
 * Reads and writes managed-agent lifecycle state inside a caller-owned database transaction.
 *
 * Revisions are never edited or deleted. Revise adds a new draft; restore adds a new draft that
 * copies an older revision and records its source, preserving the complete history.
 *
 * Called by: {@link PrismaAgentRevisionLifecycleUnitOfWork} constructs one per transaction.
 *
 * @implements AgentRevisionLifecycleRepository
 */
export class PrismaAgentRevisionLifecycleRepository implements AgentRevisionLifecycleRepository
{
	/** Transaction that owns every lifecycle read and write. */
	private readonly prisma: Prisma.TransactionClient;
	/** Writes immutable draft revisions within the same transaction. */
	private readonly revisionWriter: PrismaAgentRevisionWriterRepository;

	/** Creates a lifecycle repository inside the caller's transaction. */
	constructor(prisma: Prisma.TransactionClient)
	{
		this.prisma = prisma;
		this.revisionWriter = new PrismaAgentRevisionWriterRepository(this.prisma);
	}

	/** Lists the newest two hundred managed services from one exact silo. */
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

	/** Creates a managed service and its first immutable draft revision. */
	async createManagedService(command: CreateManagedAgentServiceCommand, createdAt: string): Promise<CreateManagedAgentServiceResult>
	{
		const createdAtDate = new Date(createdAt);
		if (!await this._IsModelDefinitionAvailable(command.content.modelDefinitionId, command.siloId))
			return { outcome: _LifecycleOutcomes.Denied, reason: AgentRevisionLifecycleDenials.ModelDefinitionUnavailable };
		const agentServiceId = randomUUID();
		const principalId = await __CreateManagedAgentServicePrincipalRepository(this.prisma).create(command.siloId, agentServiceId, command.name, createdAtDate);
		const serviceRow = await this.prisma.agentService.create({ data: { id: agentServiceId, siloId: command.siloId, kind: AgentServiceKind.Managed, name: command.name, state: AgentServiceState.Draft, workloadProfile: command.workloadProfile, principalId, createdAt: createdAtDate, updatedAt: createdAtDate } });
		const revisionRow = await this.revisionWriter.createDraft({
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
		return { outcome: _LifecycleOutcomes.Created, service: _mapService(serviceRow), revision: _mapRevision(revisionRow) };
	}

	/** Appends a new draft revision after claiming the expected head. */
	async reviseRevision(command: ReviseAgentRevisionCommand, createdAt: string): Promise<AppendAgentRevisionResult>
	{
		const createdAtDate = new Date(createdAt);
		const guard = await this._ClaimAndReadHead(command.agentServiceId, command.siloId, command.expectedParentRevisionId, createdAtDate);
		if (guard.outcome !== _HeadGuardOutcomes.Ready)
			return guard.result;
		if (!await this._IsModelDefinitionAvailable(command.content.modelDefinitionId, guard.siloId))
			return { outcome: _LifecycleOutcomes.Denied, reason: AgentRevisionLifecycleDenials.ModelDefinitionUnavailable };
		const revisionRow = await this.revisionWriter.createDraft({
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
		return { outcome: _LifecycleOutcomes.Revised, revision: _mapRevision(revisionRow) };
	}

	/** Clones an older revision into a new draft after claiming the expected head. */
	async restoreRevision(command: RestoreAgentRevisionCommand, createdAt: string): Promise<AppendAgentRevisionResult>
	{
		const createdAtDate = new Date(createdAt);
		const guard = await this._ClaimAndReadHead(command.agentServiceId, command.siloId, command.expectedParentRevisionId, createdAtDate);
		if (guard.outcome !== _HeadGuardOutcomes.Ready)
			return guard.result;
		// Silo scope makes a foreign revision indistinguishable from a missing revision.
		const source = await this.prisma.agentRevision.findFirst({ where: { id: command.sourceRevisionId, agentService: { is: { siloId: command.siloId } } }, include: _AGENT_REVISION_INCLUDE });
		if (source === null)
			return { outcome: _LifecycleOutcomes.Denied, reason: AgentRevisionLifecycleDenials.RevisionNotFound };
		if (source.agentServiceId !== command.agentServiceId)
			return { outcome: _LifecycleOutcomes.Denied, reason: AgentRevisionLifecycleDenials.RevisionServiceMismatch };
		const revisionRow = await this.revisionWriter.createDraft({
			siloId: guard.siloId,
			agentServiceId: command.agentServiceId,
			revision: guard.head.revision + 1,
			parentRevisionId: guard.head.id,
			sourceRevisionId: source.id,
			content: _AgentRevisionContentFromRow(source),
			changeMessage: command.changeMessage,
			authoredBy: command.authoredBy,
			createdAt: createdAtDate,
		});
		return { outcome: _LifecycleOutcomes.Revised, revision: _mapRevision(revisionRow) };
	}

	/** Changes one stable service state after checking the expected state. */
	async changeServiceState(command: ChangeAgentServiceStateCommand, changedAt: string): Promise<ChangeAgentServiceStateResult>
	{
		const changedAtDate = new Date(changedAt);
		const row = await this.prisma.agentService.findFirst({ where: { id: command.agentServiceId, siloId: command.siloId } });
		if (row === null)
			return { outcome: _LifecycleOutcomes.Denied, reason: AgentRevisionLifecycleDenials.ServiceNotFound };
		if (_serviceState(row.state) !== command.expectedState)
			return { outcome: _LifecycleOutcomes.Conflict, currentState: _serviceState(row.state) };
		if (command.action === AgentServiceLifecycleActions.Enable && row.activeRevisionId === null)
			return { outcome: _LifecycleOutcomes.Denied, reason: AgentRevisionLifecycleDenials.ServiceNotRunnable };
		const changed = await this.prisma.agentService.updateMany({
			where: { id: command.agentServiceId, siloId: command.siloId, state: row.state, activeRevisionId: row.activeRevisionId },
			data: {
				state: _targetServiceState(command.action),
				activeRevisionId: command.action === AgentServiceLifecycleActions.Retire ? null : undefined,
				updatedAt: changedAtDate,
			},
		});
		if (changed.count !== 1)
		{
			const winner = await this.prisma.agentService.findFirst({ where: { id: command.agentServiceId, siloId: command.siloId } });
			if (winner === null)
				return { outcome: _LifecycleOutcomes.Denied, reason: AgentRevisionLifecycleDenials.ServiceNotFound };
			return { outcome: _LifecycleOutcomes.Conflict, currentState: _serviceState(winner.state) };
		}
		const updated = await this.prisma.agentService.findUniqueOrThrow({ where: { id: command.agentServiceId } });
		return { outcome: _LifecycleOutcomes.Changed, service: _mapService(updated) };
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

	/** Returns whether a model definition is global or belongs to the service's tenant scope. */
	private async _IsModelDefinitionAvailable(modelDefinitionId: string, siloId: string): Promise<boolean>
	{
		const definition = await this.prisma.modelDefinition.findUnique({ where: { id: modelDefinitionId }, select: { scope: true, clusterTenant: true } });
		return definition?.scope === ModelRoutingScope.Global || (definition?.scope === ModelRoutingScope.ClusterTenant && definition.clusterTenant === siloId);
	}

	/** Claims the exact service row and validates the expected head revision. */
	private async _ClaimAndReadHead(agentServiceId: string, siloId: string, expectedParentRevisionId: string | null, claimedAt: Date): Promise<_HeadGuard>
	{
		const service = await this.prisma.agentService.findFirst({ where: { id: agentServiceId, siloId } });
		if (service === null)
			return { outcome: _HeadGuardOutcomes.Blocked, result: { outcome: _LifecycleOutcomes.Denied, reason: AgentRevisionLifecycleDenials.ServiceNotFound } };
		if (_serviceState(service.state) === AgentServiceStates.Retired)
			return { outcome: _HeadGuardOutcomes.Blocked, result: { outcome: _LifecycleOutcomes.Denied, reason: AgentRevisionLifecycleDenials.ServiceRetired } };
		const head = await this.prisma.agentRevision.findFirst({ where: { agentServiceId }, orderBy: { revision: "desc" }, select: { id: true, revision: true } });
		if (head === null || head.id !== expectedParentRevisionId)
			return { outcome: _HeadGuardOutcomes.Blocked, result: { outcome: _LifecycleOutcomes.Conflict, currentHeadRevisionId: head?.id ?? null } };
		const claimed = await this.prisma.agentService.updateMany({
			where: { id: agentServiceId, siloId, state: service.state, activeRevisionId: service.activeRevisionId, updatedAt: service.updatedAt },
			data: { updatedAt: claimedAt },
		});
		if (claimed.count === 1)
			return { outcome: _HeadGuardOutcomes.Ready, siloId: service.siloId, head };
		const winner = await this.prisma.agentService.findFirst({ where: { id: agentServiceId, siloId } });
		if (winner === null)
			return { outcome: _HeadGuardOutcomes.Blocked, result: { outcome: _LifecycleOutcomes.Denied, reason: AgentRevisionLifecycleDenials.ServiceNotFound } };
		if (_serviceState(winner.state) === AgentServiceStates.Retired)
			return { outcome: _HeadGuardOutcomes.Blocked, result: { outcome: _LifecycleOutcomes.Denied, reason: AgentRevisionLifecycleDenials.ServiceRetired } };
		const winnerHead = await this.prisma.agentRevision.findFirst({ where: { agentServiceId }, orderBy: { revision: "desc" }, select: { id: true } });
		return { outcome: _HeadGuardOutcomes.Blocked, result: { outcome: _LifecycleOutcomes.Conflict, currentHeadRevisionId: winnerHead?.id ?? null } };
	}
}

/**
 * Opens serializable transactions around managed-agent lifecycle repository work.
 *
 * Called by: `_CreateAgentServicesRouter` in `prisma-agent-services.router.ts`.
 *
 * @implements AgentRevisionLifecycleRepository
 */
export class PrismaAgentRevisionLifecycleUnitOfWork implements AgentRevisionLifecycleRepository
{
	/** OpenCrane product-authority database client. */
	private readonly prisma: PrismaClient;

	/** Creates the lifecycle unit of work over canonical Postgres. */
	constructor(prisma: PrismaClient)
	{
		this.prisma = prisma;
	}

	/** Lists managed services inside one serializable transaction. */
	listManagedServices(siloId: string): Promise<readonly AgentService[]>
	{
		return this._Run(function _List(repository) { return repository.listManagedServices(siloId); });
	}

	/** Loads one service inside one serializable transaction. */
	getService(agentServiceId: string, siloId: string): ReturnType<AgentRevisionLifecycleRepository["getService"]>
	{
		return this._Run(function _GetService(repository) { return repository.getService(agentServiceId, siloId); });
	}

	/** Loads one revision inside one serializable transaction. */
	getRevision(agentRevisionId: string, siloId: string): ReturnType<AgentRevisionLifecycleRepository["getRevision"]>
	{
		return this._Run(function _GetRevision(repository) { return repository.getRevision(agentRevisionId, siloId); });
	}

	/** Creates one service and first revision inside one serializable transaction. */
	createManagedService(command: CreateManagedAgentServiceCommand, createdAt: string): Promise<CreateManagedAgentServiceResult>
	{
		return this._Run(function _Create(repository) { return repository.createManagedService(command, createdAt); });
	}

	/** Appends one draft revision inside one serializable transaction. */
	reviseRevision(command: ReviseAgentRevisionCommand, createdAt: string): Promise<AppendAgentRevisionResult>
	{
		return this._Run(function _Revise(repository) { return repository.reviseRevision(command, createdAt); });
	}

	/** Restores one revision inside one serializable transaction. */
	restoreRevision(command: RestoreAgentRevisionCommand, createdAt: string): Promise<AppendAgentRevisionResult>
	{
		return this._Run(function _Restore(repository) { return repository.restoreRevision(command, createdAt); });
	}

	/** Changes one service state inside one serializable transaction. */
	changeServiceState(command: ChangeAgentServiceStateCommand, changedAt: string): Promise<ChangeAgentServiceStateResult>
	{
		return this._Run(function _Change(repository) { return repository.changeServiceState(command, changedAt); });
	}

	/** Reads one service history inside one serializable transaction. */
	readHistory(agentServiceId: string, siloId: string, runLimit: number): Promise<AgentServiceHistory>
	{
		return this._Run(function _History(repository) { return repository.readHistory(agentServiceId, siloId, runLimit); });
	}

	/** Runs one lifecycle operation in a serializable transaction. */
	private _Run<TResult>(operation: (repository: PrismaAgentRevisionLifecycleRepository) => Promise<TResult>): Promise<TResult>
	{
		return this.prisma.$transaction(async function _Run(transaction: Prisma.TransactionClient)
		{
			const repository = new PrismaAgentRevisionLifecycleRepository(transaction);
			return operation(repository);
		}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
	}
}
