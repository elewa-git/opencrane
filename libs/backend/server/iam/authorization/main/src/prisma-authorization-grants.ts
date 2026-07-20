import type { PrismaClient } from "@prisma/client";

import type { AuthorizationGrant, AuthorizationScope } from "@opencrane/models/authorization";

import type { AuthorizationGrantRepository } from "./effective-access.types.js";

/** Maps one Prisma grant scope to the independent target authorization dimension. */
function _scope(kind: string, organizationId: string, resourceId: string | null): AuthorizationScope
{
	switch (kind)
	{
		case "Organization": return { kind: "organization", organizationId };
		case "Department": return { kind: "department", organizationId, departmentId: resourceId ?? "" };
		case "Team": return { kind: "team", organizationId, teamId: resourceId ?? "" };
		case "Project": return { kind: "project", organizationId, projectId: resourceId ?? "" };
		case "Personal": return { kind: "personal", organizationId, userId: resourceId ?? "" };
		case "DirectUser": return { kind: "direct-user", organizationId, userId: resourceId ?? "" };
		default: throw new Error(`unknown authorization grant scope: ${kind}`);
	}
}

/** Maps one immutable Prisma authorization grant to the target evaluation contract. */
function _grant(row: { id: string; siloId: string; subjectId: string; scopeKind: string; organizationId: string; scopeResourceId: string | null; catalogId: string; catalogRevision: number; catalogDigest: string; capabilityId: string; resourceKind: string; resourceId: string; effect: string; priority: number; validFrom: Date; expiresAt: Date | null; revokedAt: Date | null }): AuthorizationGrant
{
	return {
		grantId: row.id,
		siloId: row.siloId,
		subjectId: row.subjectId,
		scope: _scope(row.scopeKind, row.organizationId, row.scopeResourceId),
		capability: { catalog: { catalogId: row.catalogId, revision: row.catalogRevision, digest: row.catalogDigest as `sha256:${string}` }, capabilityId: row.capabilityId },
		resource: { kind: row.resourceKind, id: row.resourceId },
		effect: row.effect === "Allow" ? "allow" : "deny",
		priority: row.priority,
		validFromEpochMs: row.validFrom.getTime(),
		expiresAtEpochMs: row.expiresAt?.getTime() ?? null,
		revokedAtEpochMs: row.revokedAt?.getTime() ?? null,
	};
}

/** Prisma-backed candidate-grant reader for deterministic effective-access evaluation. */
export class PrismaAuthorizationGrantRepository implements AuthorizationGrantRepository
{
	/** OpenCrane product-authority database client. */
	private readonly prisma: PrismaClient;

	/** Creates a grant reader over canonical Postgres. */
	constructor(prisma: PrismaClient)
	{
		this.prisma = prisma;
	}

	/** Lists only immutable grants for one exact silo and subject. */
	async listSubjectGrants(siloId: string, subjectId: string): Promise<readonly AuthorizationGrant[]>
	{
		const rows = await this.prisma.authorizationGrant.findMany({ where: { siloId, subjectId }, orderBy: [{ priority: "desc" }, { id: "asc" }] });
		return rows.map(_grant);
	}
}
