import { AgentRevisionState, AgentServiceState, Prisma, type PrismaClient } from "@prisma/client";

import type { AgentRevision, AgentService } from "@opencrane/models/agents";

import { __AppendAuditDecision } from "@opencrane/backend/server/iam/audit";
import type { AgentServicePublicationRepository, AtomicAgentRevisionPublication, AtomicAgentRevisionPublicationResult } from "./agent-publication.types.js";
import { _mapRevision, _mapService, _serviceState } from "./prisma-agent-mappers.js";
import type { AgentPublicationAuditEvidencePort } from "./prisma-agent-publication.types.js";

/** Prisma-backed publication adapter that commits revision, active pointer, and audit atomically. */
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
		const row = await this.prisma.agentRevision.findFirst({ where: { id: agentRevisionId, agentService: { is: { siloId } } }, include: { skillAssignments: true, integrationAssignments: true, scopeAttachments: true } });
		return row === null ? null : _mapRevision(row);
	}

	/** Atomically publishes and activates only the locked expected authority state. */
	async publishRevisionAtomically(publication: AtomicAgentRevisionPublication): Promise<AtomicAgentRevisionPublicationResult>
	{
		const auditEvidence = this.auditEvidence;
		return this.prisma.$transaction(async function _publish(transaction: Prisma.TransactionClient)
		{
			// 1. Lock parent service then child revision so every publication follows one deadlock-safe order.
			await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "agent_services" WHERE "id" = ${publication.agentServiceId} FOR UPDATE`);
			await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "agent_revisions" WHERE "id" = ${publication.agentRevisionId} FOR UPDATE`);
			const serviceRow = await transaction.agentService.findUnique({ where: { id: publication.agentServiceId } });
			const revisionRow = await transaction.agentRevision.findUnique({ where: { id: publication.agentRevisionId }, include: { skillAssignments: true, integrationAssignments: true, scopeAttachments: true } });
			if (serviceRow === null || revisionRow === null || _serviceState(serviceRow.state) !== publication.expectedServiceState || serviceRow.activeRevisionId !== publication.expectedActiveRevisionId || revisionRow.agentServiceId !== publication.agentServiceId || revisionRow.state !== AgentRevisionState.Draft)
			{
				return { status: "conflict", currentActiveRevisionId: serviceRow?.activeRevisionId ?? null } as const;
			}

			// 2. Change both lifecycle coordinates inside the same transaction so neither can escape alone.
			const publishedRow = await transaction.agentRevision.update({ where: { id: publication.agentRevisionId }, data: { state: AgentRevisionState.Published, publishedAt: new Date(publication.publishedAt) }, include: { skillAssignments: true, integrationAssignments: true, scopeAttachments: true } });
			const activeRow = await transaction.agentService.update({ where: { id: publication.agentServiceId }, data: { state: AgentServiceState.Active, activeRevisionId: publication.agentRevisionId, updatedAt: new Date(publication.publishedAt) } });

			// 3. Append authenticated decision evidence before commit; audit failure rolls back publication.
			const service = _mapService(serviceRow);
			const revision = _mapRevision(revisionRow);
			await __AppendAuditDecision(transaction, auditEvidence.build(publication, service, revision));
			return { status: "published", service: _mapService(activeRow), revision: _mapRevision(publishedRow) } as const;
		});
	}
}
