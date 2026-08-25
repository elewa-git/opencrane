import type { Prisma } from "@prisma/client";

import { AuthorizationBoundaryCoverages, AuthorizationBoundaryKinds, AuthorizationGrantEffects, AuthorizationSubjectKinds } from "@opencrane/models/authorization";
import type { AuthorizationBoundary, AuthorizationBoundaryContext, AuthorizationGrant, AuthorizationSubject } from "@opencrane/models/authorization";

import type { AuthorizationContextRepository } from "./authorization-resolution.types";

/** Persistence projection needed to map one authorization grant. */
interface AuthorizationGrantRow
{
	/** Stable grant identifier. */
	readonly id: string;
	/** Silo that owns the grant. */
	readonly siloId: string;
	/** Prisma subject discriminator. */
	readonly subjectKind: string;
	/** Group recipient when the subject is a group. */
	readonly subjectGroupId: string | null;
	/** Principal recipient when the subject is a principal. */
	readonly subjectPrincipalId: string | null;
	/** Prisma boundary discriminator. */
	readonly boundaryKind: string;
	/** Group boundary when the grant targets a hierarchy node. */
	readonly boundaryGroupId: string | null;
	/** Principal boundary when the grant targets personal resources. */
	readonly boundaryPrincipalId: string | null;
	/** Prisma boundary coverage discriminator. */
	readonly boundaryCoverage: string;
	/** Capability catalog identifier. */
	readonly catalogId: string;
	/** Capability catalog revision. */
	readonly catalogRevision: number;
	/** Capability catalog digest. */
	readonly catalogDigest: string;
	/** Capability identifier. */
	readonly capabilityId: string;
	/** Resource family. */
	readonly resourceKind: string;
	/** Resource identifier. */
	readonly resourceId: string;
	/** Prisma effect discriminator. */
	readonly effect: string;
	/** Grant precedence. */
	readonly priority: number;
	/** Inclusive activation time. */
	readonly validFrom: Date;
	/** Exclusive expiry time. */
	readonly expiresAt: Date | null;
	/** Revocation time. */
	readonly revokedAt: Date | null;
}

/** Maps one persisted grant subject and rejects an inconsistent discriminator. */
function _subject(row: AuthorizationGrantRow): AuthorizationSubject
{
	if (row.subjectKind === "Group" && row.subjectGroupId !== null && row.subjectPrincipalId === null)
	{
		return { kind: AuthorizationSubjectKinds.Group, groupId: row.subjectGroupId };
	}
	if (row.subjectKind === "Principal" && row.subjectPrincipalId !== null && row.subjectGroupId === null)
	{
		return { kind: AuthorizationSubjectKinds.Principal, principalId: row.subjectPrincipalId };
	}
	throw new Error(`authorization grant ${row.id} has inconsistent subject fields`);
}

/** Maps one persisted grant boundary and rejects an inconsistent discriminator. */
function _boundary(row: AuthorizationGrantRow): AuthorizationBoundary
{
	if (row.boundaryKind === "Group" && row.boundaryGroupId !== null && row.boundaryPrincipalId === null)
	{
		return { kind: AuthorizationBoundaryKinds.Group, groupId: row.boundaryGroupId };
	}
	if (row.boundaryKind === "Personal" && row.boundaryPrincipalId !== null && row.boundaryGroupId === null)
	{
		return { kind: AuthorizationBoundaryKinds.Personal, principalId: row.boundaryPrincipalId };
	}
	throw new Error(`authorization grant ${row.id} has inconsistent boundary fields`);
}

/** Maps one persisted coverage value into the domain vocabulary. */
function _coverage(row: AuthorizationGrantRow): AuthorizationBoundaryCoverages
{
	if (row.boundaryCoverage === "Exact") return AuthorizationBoundaryCoverages.Exact;
	if (row.boundaryCoverage === "Descendants") return AuthorizationBoundaryCoverages.Descendants;
	throw new Error(`authorization grant ${row.id} has unknown boundary coverage`);
}

/** Converts one authorization-grant row into the domain shape read by the decision code. */
function _grant(row: AuthorizationGrantRow): AuthorizationGrant
{
	return {
		grantId: row.id,
		siloId: row.siloId,
		subject: _subject(row),
		boundary: _boundary(row),
		boundaryCoverage: _coverage(row),
		capability: { catalog: { catalogId: row.catalogId, revision: row.catalogRevision, digest: row.catalogDigest as `sha256:${string}` }, capabilityId: row.capabilityId },
		resource: { kind: row.resourceKind, id: row.resourceId },
		effect: row.effect === "Allow" ? AuthorizationGrantEffects.Allow : AuthorizationGrantEffects.Deny,
		priority: row.priority,
		validFromEpochMs: row.validFrom.getTime(),
		expiresAtEpochMs: row.expiresAt?.getTime() ?? null,
		revokedAtEpochMs: row.revokedAt?.getTime() ?? null,
	};
}

/** Builds the Prisma predicate for one resolved subject. */
function _subjectWhere(subject: AuthorizationSubject): Prisma.AuthorizationGrantWhereInput
{
	if (subject.kind === AuthorizationSubjectKinds.Group)
	{
		return { subjectKind: "Group", subjectGroupId: subject.groupId, subjectPrincipalId: null };
	}
	return { subjectKind: "Principal", subjectPrincipalId: subject.principalId, subjectGroupId: null };
}

/** Reads generic authorization context from the product-authority database. */
export class PrismaAuthorizationGrantRepository implements AuthorizationContextRepository
{
	/** OpenCrane product-authority database client. */
	private readonly prisma: Prisma.TransactionClient;

	/** Creates an authorization reader over the product-authority Postgres database. */
	constructor(prisma: Prisma.TransactionClient)
	{
		this.prisma = prisma;
	}

	/** Resolves the principal and groups that contain a direct membership row. */
	async resolvePrincipalSubjects(siloId: string, principalId: string): Promise<readonly AuthorizationSubject[]>
	{
		const principal = await this.prisma.principal.findUnique({ where: { id_siloId: { id: principalId, siloId } }, select: { id: true } });
		if (principal === null) return [];
		const memberships = await this.prisma.groupMembership.findMany({ where: { siloId, principalId }, select: { groupId: true }, orderBy: { groupId: "asc" } });
		return [
			{ kind: AuthorizationSubjectKinds.Principal, principalId },
			...memberships.map(membership => ({ kind: AuthorizationSubjectKinds.Group, groupId: membership.groupId }) as const),
		];
	}

	/** Loads the requested group's ancestor path from stored parent relations. */
	async resolveBoundaryContext(siloId: string, boundary: AuthorizationBoundary): Promise<AuthorizationBoundaryContext>
	{
		if (boundary.kind === AuthorizationBoundaryKinds.Personal)
		{
			const principal = await this.prisma.principal.findUnique({ where: { id_siloId: { id: boundary.principalId, siloId } }, select: { id: true } });
			return { requestedGroupAncestorIds: principal === null ? ["__missing_personal_boundary__"] : [] };
		}

		const groups = await this.prisma.group.findMany({ where: { siloId }, select: { id: true, parentId: true } });
		const parentById = new Map(groups.map(group => [group.id, group.parentId]));
		if (!parentById.has(boundary.groupId)) return { requestedGroupAncestorIds: ["__missing_group_boundary__"] };
		const ancestors: string[] = [];
		const visited = new Set([boundary.groupId]);
		let parentId = parentById.get(boundary.groupId) ?? null;
		while (parentId !== null)
		{
			if (visited.has(parentId)) throw new Error("group hierarchy contains a cycle");
			if (!parentById.has(parentId)) throw new Error("group hierarchy references a missing parent");
			visited.add(parentId);
			ancestors.push(parentId);
			parentId = parentById.get(parentId) ?? null;
		}
		return { requestedGroupAncestorIds: ancestors };
	}

	/** Lists every candidate grant for the resolved principal and direct groups. */
	async listSubjectGrants(siloId: string, subjects: readonly AuthorizationSubject[]): Promise<readonly AuthorizationGrant[]>
	{
		if (subjects.length === 0) return [];
		const rows = await this.prisma.authorizationGrant.findMany({ where: { siloId, OR: subjects.map(_subjectWhere) }, orderBy: [{ priority: "desc" }, { id: "asc" }] });
		return rows.map(_grant);
	}
}
