import type { Prisma } from "@prisma/client";

import type { AuthorizationGrant, AuthorizationScope } from "@opencrane/models/authorization";

import type { AuthorizationGrantRepository } from "./effective-access.types";

/** Builds the AuthorizationScope value for one grant row's scope kind and its organization/resource ids. */
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

/** Converts one authorization-grant row into the AuthorizationGrant shape the decision code reads. */
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

/**
 * Reads a subject's grants from Postgres.
 *
 * Returns every grant for the subject, including expired and revoked ones, ordered by priority then
 * id. Filtering is left to the pure decision code, which needs the full set to apply
 * deny-over-allow and priority correctly, and the fixed order keeps results repeatable.
 *
 * Constructed by: ./prisma-share-authorization-unit-of-work.ts.
 */
export class PrismaAuthorizationGrantRepository implements AuthorizationGrantRepository
{
	/** OpenCrane product-authority database client. */
	private readonly prisma: Prisma.TransactionClient;

	/** Creates a grant reader over the product-authority Postgres database. */
	constructor(prisma: Prisma.TransactionClient)
	{
		this.prisma = prisma;
	}

	/** Lists every grant for one silo and subject, highest priority first. */
	async listSubjectGrants(siloId: string, subjectId: string): Promise<readonly AuthorizationGrant[]>
	{
		const rows = await this.prisma.authorizationGrant.findMany({ where: { siloId, subjectId }, orderBy: [{ priority: "desc" }, { id: "asc" }] });
		return rows.map(_grant);
	}
}
