import { AgentRevisionState, AgentServiceState, Prisma, type PrismaClient } from "@prisma/client";

import type { AgentBudget, AgentRevision, AgentRevisionState as DomainAgentRevisionState, AgentService, AgentServiceKind, AgentServiceState as DomainAgentServiceState, AgentOwnerScope } from "@opencrane/models/agents";

import { __AppendAuditDecision } from "@opencrane/backend/server/audit";
import type { AgentServicePublicationRepository, AtomicAgentRevisionPublication, AtomicAgentRevisionPublicationResult } from "./agent-publication.types.js";
import type { AgentPublicationAuditEvidencePort } from "./prisma-agent-publication.types.js";

/** Maps a Prisma AgentService lifecycle identifier to the target contract value. */
function _serviceState(value: string): DomainAgentServiceState
{
	switch (value)
	{
		case "Draft": return "draft";
		case "Active": return "active";
		case "Paused": return "paused";
		case "Retired": return "retired";
		default: throw new Error(`unknown AgentService state: ${value}`);
	}
}

/** Maps a Prisma AgentService kind identifier to the target contract value. */
function _serviceKind(value: string): AgentServiceKind
{
	if (value === "Personal") return "personal";
	if (value === "Managed") return "managed";
	throw new Error(`unknown AgentService kind: ${value}`);
}

/** Maps a Prisma owner-scope identifier to the independent target dimension. */
function _ownerScope(value: string): AgentOwnerScope
{
	switch (value)
	{
		case "Organization": return "organization";
		case "Department": return "department";
		case "Team": return "team";
		case "Project": return "project";
		case "Personal": return "personal";
		case "User": return "user";
		default: throw new Error(`unknown AgentService owner scope: ${value}`);
	}
}

/** Maps a Prisma AgentRevision lifecycle identifier to the target contract value. */
function _revisionState(value: string): DomainAgentRevisionState
{
	switch (value)
	{
		case "Draft": return "draft";
		case "Published": return "published";
		case "Rejected": return "rejected";
		case "Retired": return "retired";
		default: throw new Error(`unknown AgentRevision state: ${value}`);
	}
}

/** Maps one locked Prisma service row to the dependency-light target contract. */
function _mapService(row: { id: string; siloId: string; kind: string; name: string; ownerScope: string; ownerSubjectId: string; state: string; activeRevisionId: string | null; workloadProfile: string; createdAt: Date; updatedAt: Date }): AgentService
{
	return {
		id: row.id,
		siloId: row.siloId,
		kind: _serviceKind(row.kind),
		name: row.name,
		owner: { scope: _ownerScope(row.ownerScope), subjectId: row.ownerSubjectId },
		state: _serviceState(row.state),
		activeRevisionId: row.activeRevisionId,
		workloadProfile: row.workloadProfile,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}

/** Maps one locked Prisma revision row and its immutable assignments to the target contract. */
function _mapRevision(row: { id: string; agentServiceId: string; revision: number; state: string; digest: string; promptPolicyVersion: string; personaRevisionId: string | null; modelPolicyId: string; budget: Prisma.JsonValue; authoredBy: string; createdAt: Date; publishedAt: Date | null; skillAssignments: Array<{ skillId: string; skillRevisionId: string }>; integrationAssignments: Array<{ integrationId: string; custodyReferenceId: string; allowedTools: string[] }> }): AgentRevision
{
	return {
		id: row.id,
		agentServiceId: row.agentServiceId,
		revision: row.revision,
		state: _revisionState(row.state),
		digest: row.digest,
		promptPolicyVersion: row.promptPolicyVersion,
		personaRevisionId: row.personaRevisionId,
		modelPolicyId: row.modelPolicyId,
		skills: row.skillAssignments.map(assignment => ({ skillId: assignment.skillId, revisionId: assignment.skillRevisionId })),
		integrationAssignments: row.integrationAssignments.map(assignment => ({ integrationId: assignment.integrationId, custodyReferenceId: assignment.custodyReferenceId, allowedTools: assignment.allowedTools })),
		budget: row.budget as unknown as AgentBudget,
		authoredBy: row.authoredBy,
		createdAt: row.createdAt.toISOString(),
		publishedAt: row.publishedAt?.toISOString() ?? null,
	};
}

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

	/** Loads one stable service identity without mutating it. */
	async getService(agentServiceId: string): Promise<AgentService | null>
	{
		const row = await this.prisma.agentService.findUnique({ where: { id: agentServiceId } });
		return row === null ? null : _mapService(row);
	}

	/** Loads one immutable revision and all executable assignments. */
	async getRevision(agentRevisionId: string): Promise<AgentRevision | null>
	{
		const row = await this.prisma.agentRevision.findUnique({ where: { id: agentRevisionId }, include: { skillAssignments: true, integrationAssignments: true } });
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
			const revisionRow = await transaction.agentRevision.findUnique({ where: { id: publication.agentRevisionId }, include: { skillAssignments: true, integrationAssignments: true } });
			if (serviceRow === null || revisionRow === null || _serviceState(serviceRow.state) !== publication.expectedServiceState || serviceRow.activeRevisionId !== publication.expectedActiveRevisionId || revisionRow.agentServiceId !== publication.agentServiceId || revisionRow.state !== AgentRevisionState.Draft)
			{
				return { status: "conflict", currentActiveRevisionId: serviceRow?.activeRevisionId ?? null } as const;
			}

			// 2. Change both lifecycle coordinates inside the same transaction so neither can escape alone.
			const publishedRow = await transaction.agentRevision.update({ where: { id: publication.agentRevisionId }, data: { state: AgentRevisionState.Published, publishedAt: new Date(publication.publishedAt) }, include: { skillAssignments: true, integrationAssignments: true } });
			const activeRow = await transaction.agentService.update({ where: { id: publication.agentServiceId }, data: { state: AgentServiceState.Active, activeRevisionId: publication.agentRevisionId, updatedAt: new Date(publication.publishedAt) } });

			// 3. Append authenticated decision evidence before commit; audit failure rolls back publication.
			const service = _mapService(serviceRow);
			const revision = _mapRevision(revisionRow);
			await __AppendAuditDecision(transaction, auditEvidence.build(publication, service, revision));
			return { status: "published", service: _mapService(activeRow), revision: _mapRevision(publishedRow) } as const;
		});
	}
}
