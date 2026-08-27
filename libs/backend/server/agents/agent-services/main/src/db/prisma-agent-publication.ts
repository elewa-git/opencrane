import { AgentRevisionState, AgentServiceState, McpApprovalStatus, McpServerRevisionState, McpServerStatus, type PrismaClient } from "@prisma/client";

import type { AgentRevision, AgentService } from "@opencrane/models/agents";

import { __AppendAuditDecision } from "@opencrane/backend/server/iam/audit";
import type { AgentPublicationAuditEvidencePort, AgentServicePublicationRepository, AtomicAgentRevisionPublication, AtomicAgentRevisionPublicationResult } from "../agent-publication.types";
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
 * Called by: `_publicationFor` in `prisma-agent-services.router.ts` builds one per request so the
 * audit row names the administrator publishing.
 */
export class PrismaAgentServicePublicationRepository implements AgentServicePublicationRepository
{
	/** OpenCrane product-authority database client. */
	private readonly prisma: PrismaClient;
	/** Exact audit evidence builder supplied by the authenticated driving use case. */
	private readonly auditEvidence: AgentPublicationAuditEvidencePort;

	/**
	 * Creates a publication adapter over the canonical Postgres authority.
	 * @param prisma - OpenCrane Prisma client.
	 * @param auditEvidence - Authenticated publication evidence builder.
	 */
	constructor(prisma: PrismaClient, auditEvidence: AgentPublicationAuditEvidencePort)
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
		const auditEvidence = this.auditEvidence;
		try
		{
			return await this.prisma.$transaction(async function _publish(transaction)
			{
				// 1. Read the expected authority state before trying to own its exact coordinates.
				const serviceRow = await transaction.agentService.findUnique({ where: { id: publication.agentServiceId } });
				const revisionRow = await transaction.agentRevision.findUnique({ where: { id: publication.agentRevisionId }, include: { skillAssignments: true, mcpToolAssignments: { include: { toolRevision: { include: { serverRevision: { include: { server: true } } } } } }, boundaryAttachments: true } });
				if (serviceRow === null || revisionRow === null || _serviceState(serviceRow.state) !== publication.expectedServiceState || serviceRow.activeRevisionId !== publication.expectedActiveRevisionId || revisionRow.agentServiceId !== publication.agentServiceId || revisionRow.state !== AgentRevisionState.Draft)
					return { status: "conflict", currentActiveRevisionId: serviceRow?.activeRevisionId ?? null } as const;
				if (revisionRow.mcpToolAssignments.some(function _UnavailableMcpTool(assignment): boolean
				{
					return assignment.siloId !== serviceRow.siloId
						|| assignment.toolRevision.serverRevision.state !== McpServerRevisionState.Ready
						|| assignment.toolRevision.serverRevision.server.status !== McpServerStatus.Active
						|| assignment.toolRevision.serverRevision.server.approvalStatus !== McpApprovalStatus.Published;
				}))
					return { status: "invalid_revision" } as const;

				// 2. Claim the exact service state, then publish the exact draft. A lost second write throws so
				// the first write also rolls back.
				const publishedAt = new Date(publication.publishedAt);
				const activated = await transaction.agentService.updateMany({
					where: { id: publication.agentServiceId, siloId: serviceRow.siloId, state: serviceRow.state, activeRevisionId: serviceRow.activeRevisionId },
					data: { state: AgentServiceState.Active, activeRevisionId: publication.agentRevisionId, updatedAt: publishedAt },
				});
				if (activated.count !== 1)
					throw new _PublicationConflict();
				const published = await transaction.agentRevision.updateMany({ where: { id: publication.agentRevisionId, agentServiceId: publication.agentServiceId, state: AgentRevisionState.Draft }, data: { state: AgentRevisionState.Published, publishedAt } });
				if (published.count !== 1)
					throw new _PublicationConflict();
				const [activeRow, publishedRow] = await Promise.all([
					transaction.agentService.findUniqueOrThrow({ where: { id: publication.agentServiceId } }),
					transaction.agentRevision.findUniqueOrThrow({ where: { id: publication.agentRevisionId }, include: { skillAssignments: true, mcpToolAssignments: true, boundaryAttachments: true } }),
				]);

				// 3. Append authenticated decision evidence before commit; audit failure rolls back publication.
				const service = _mapService(serviceRow);
				const revision = _mapRevision(revisionRow);
				await __AppendAuditDecision(transaction, auditEvidence.build(publication, service, revision));
				return { status: "published", service: _mapService(activeRow), revision: _mapRevision(publishedRow) } as const;
			});
		}
		catch (error)
		{
			if (!(error instanceof _PublicationConflict))
				throw error;
			const winner = await this.prisma.agentService.findUnique({ where: { id: publication.agentServiceId }, select: { activeRevisionId: true } });
			return { status: "conflict", currentActiveRevisionId: winner?.activeRevisionId ?? null } as const;
		}
	}
}
