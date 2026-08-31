import { AgentRevisionState, AgentServiceState, McpApprovalStatus, McpServerRevisionState, McpServerStatus, Prisma, type PrismaClient } from "@prisma/client";

import type { AgentRevision, AgentService } from "@opencrane/models/agents";

import { __AppendAuditDecision } from "@opencrane/backend/server/iam/audit";
import { AtomicAgentRevisionPublicationStatuses, type AgentPublicationAuditEvidencePort, type AgentServicePublicationRepository, type AtomicAgentRevisionPublication, type AtomicAgentRevisionPublicationResult } from "../agent-publication.types";
import { _mapRevision, _mapService, _serviceState } from "./prisma-agent-mappers";

/** Signals that a conditional publication write lost ownership and must roll its transaction back. */
class _PublicationConflict extends Error {}

/**
 * Publishes agent revisions in Postgres, writing the revision, the service's active revision, and the
 * audit row in one transaction.
 *
 * All three land together or none does, so there is no window where a service points at a revision
 * with no audit trail, and a failed audit write cancels the publication.
 *
 * Called by: {@link PrismaAgentServicePublicationUnitOfWork} constructs one for each transaction.
 */
export class PrismaAgentServicePublicationRepository implements AgentServicePublicationRepository
{
	/** Transaction that owns the publication and audit row. */
	private readonly prisma: Prisma.TransactionClient;
	/** Exact audit evidence builder supplied by the authenticated driving use case. */
	private readonly auditEvidence: AgentPublicationAuditEvidencePort;

	/**
	 * Creates a publication adapter over the canonical Postgres authority.
	 * @param prisma - OpenCrane Prisma client.
	 * @param auditEvidence - Authenticated publication evidence builder.
	 */
	constructor(prisma: Prisma.TransactionClient, auditEvidence: AgentPublicationAuditEvidencePort)
	{
		this.prisma = prisma;
		this.auditEvidence = auditEvidence;
	}

	/** Loads one stable service identity scoped to the caller's silo. */
	async getService(agentServiceId: string, siloId: string): Promise<AgentService | null>
	{
		const row = await this.prisma.agentService.findFirst({ where: { id: agentServiceId, siloId } });
		return row === null ? null : _mapService(row);
	}

	/** Loads one immutable revision whose parent service is in the caller's silo. */
	async getRevision(agentRevisionId: string, siloId: string): Promise<AgentRevision | null>
	{
		const row = await this.prisma.agentRevision.findFirst({ where: { id: agentRevisionId, agentService: { is: { siloId } } }, include: { skillAssignments: true, mcpToolAssignments: true, boundaryAttachments: true } });
		return row === null ? null : _mapRevision(row);
	}

	/** Atomically publishes and activates only the expected authority state. */
	async publishRevisionAtomically(publication: AtomicAgentRevisionPublication): Promise<AtomicAgentRevisionPublicationResult>
	{
		// Read the expected authority state before trying to own its exact coordinates.
		const serviceRow = await this.prisma.agentService.findUnique({ where: { id: publication.agentServiceId } });
		const revisionRow = await this.prisma.agentRevision.findUnique({ where: { id: publication.agentRevisionId }, include: { skillAssignments: true, mcpToolAssignments: { include: { toolRevision: { include: { serverRevision: { include: { server: true } } } } } }, boundaryAttachments: true } });
		if (serviceRow === null || revisionRow === null || _serviceState(serviceRow.state) !== publication.expectedServiceState || serviceRow.activeRevisionId !== publication.expectedActiveRevisionId || revisionRow.agentServiceId !== publication.agentServiceId || revisionRow.state !== AgentRevisionState.Draft)
			return { status: AtomicAgentRevisionPublicationStatuses.Conflict, currentActiveRevisionId: serviceRow?.activeRevisionId ?? null } as const;
		if (revisionRow.mcpToolAssignments.some(function _UnavailableMcpTool(assignment): boolean
		{
			return assignment.siloId !== serviceRow.siloId
				|| assignment.toolRevision.serverRevision.state !== McpServerRevisionState.Ready
				|| assignment.toolRevision.serverRevision.server.status !== McpServerStatus.Active
				|| assignment.toolRevision.serverRevision.server.approvalStatus !== McpApprovalStatus.Published;
		}))
			return { status: AtomicAgentRevisionPublicationStatuses.InvalidRevision } as const;

		// Claim the exact service state, then publish the exact draft. A lost second write throws so
		// the first write also rolls back.
		const publishedAt = new Date(publication.publishedAt);
		const activated = await this.prisma.agentService.updateMany({
			where: { id: publication.agentServiceId, siloId: serviceRow.siloId, state: serviceRow.state, activeRevisionId: serviceRow.activeRevisionId },
			data: { state: AgentServiceState.Active, activeRevisionId: publication.agentRevisionId, updatedAt: publishedAt },
		});
		if (activated.count !== 1)
			throw new _PublicationConflict();
		const published = await this.prisma.agentRevision.updateMany({ where: { id: publication.agentRevisionId, agentServiceId: publication.agentServiceId, state: AgentRevisionState.Draft }, data: { state: AgentRevisionState.Published, publishedAt } });
		if (published.count !== 1)
			throw new _PublicationConflict();
		const [activeRow, publishedRow] = await Promise.all([
			this.prisma.agentService.findUniqueOrThrow({ where: { id: publication.agentServiceId } }),
			this.prisma.agentRevision.findUniqueOrThrow({ where: { id: publication.agentRevisionId }, include: { skillAssignments: true, mcpToolAssignments: true, boundaryAttachments: true } }),
		]);

		// Append authenticated decision evidence before commit; audit failure rolls back publication.
		const service = _mapService(serviceRow);
		const revision = _mapRevision(revisionRow);
		await __AppendAuditDecision(this.prisma, this.auditEvidence.build(publication, service, revision));
		return { status: AtomicAgentRevisionPublicationStatuses.Published, service: _mapService(activeRow), revision: _mapRevision(publishedRow) } as const;
	}

	/** Reads the revision id that won a concurrent publication race. */
	async getActiveRevisionId(agentServiceId: string): Promise<string | null>
	{
		const winner = await this.prisma.agentService.findUnique({ where: { id: agentServiceId }, select: { activeRevisionId: true } });
		return winner?.activeRevisionId ?? null;
	}
}

/**
 * Opens transaction scopes around agent publication repository work.
 *
 * Called by: `_publicationFor` in `prisma-agent-services.router.ts` builds one per request so the
 * audit row names the administrator publishing.
 *
 * @implements AgentServicePublicationRepository
 */
export class PrismaAgentServicePublicationUnitOfWork implements AgentServicePublicationRepository
{
	/** OpenCrane product-authority database client. */
	private readonly prisma: PrismaClient;
	/** Exact audit evidence builder supplied by the authenticated driving use case. */
	private readonly auditEvidence: AgentPublicationAuditEvidencePort;

	/** Creates the publication unit of work over canonical Postgres. */
	constructor(prisma: PrismaClient, auditEvidence: AgentPublicationAuditEvidencePort)
	{
		this.prisma = prisma;
		this.auditEvidence = auditEvidence;
	}

	/** Loads one stable service identity scoped to the caller's silo. */
	async getService(agentServiceId: string, siloId: string): Promise<AgentService | null>
	{
		return this._Run(function _Load(repository) { return repository.getService(agentServiceId, siloId); });
	}

	/** Loads one immutable revision whose parent service is in the caller's silo. */
	async getRevision(agentRevisionId: string, siloId: string): Promise<AgentRevision | null>
	{
		return this._Run(function _Load(repository) { return repository.getRevision(agentRevisionId, siloId); });
	}

	/** Atomically publishes and activates only the expected authority state. */
	async publishRevisionAtomically(publication: AtomicAgentRevisionPublication): Promise<AtomicAgentRevisionPublicationResult>
	{
		try
		{
			return await this._Run(function _Publish(repository) { return repository.publishRevisionAtomically(publication); });
		}
		catch (error)
		{
			if (!(error instanceof _PublicationConflict))
				throw error;
			const currentActiveRevisionId = await this._Run(function _LoadWinner(repository) { return repository.getActiveRevisionId(publication.agentServiceId); });
			return { status: AtomicAgentRevisionPublicationStatuses.Conflict, currentActiveRevisionId };
		}
	}

	/** Runs one publication operation in a serializable transaction. */
	private _Run<TResult>(operation: (repository: PrismaAgentServicePublicationRepository) => Promise<TResult>): Promise<TResult>
	{
		const auditEvidence = this.auditEvidence;
		return this.prisma.$transaction(async function _Run(transaction: Prisma.TransactionClient)
		{
			const repository = new PrismaAgentServicePublicationRepository(transaction, auditEvidence);
			return operation(repository);
		}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
	}
}
