import { Prisma } from "@prisma/client";
import { AuthorizationBoundaryCoverages, AuthorizationBoundaryKinds, AuthorizationSubjectKinds } from "@opencrane/models/authorization";
import type { AuthorizationBoundary, AuthorizationSubject } from "@opencrane/models/authorization";

import type { CreateOrFindShareAuthorizationGrantResult, CreateShareAuthorizationGrant, ShareAuthorizationGrant, ShareAuthorizationRepository, ShareCapabilityCatalogRevision } from "./share-authorization-repository.types";

/** Exact persistence fields that the sharing contract may expose. */
const _SHARE_SELECT = {
	id: true,
	subjectKind: true,
	subjectGroupId: true,
	subjectPrincipalId: true,
	boundaryKind: true,
	boundaryGroupId: true,
	boundaryPrincipalId: true,
	boundaryCoverage: true,
	resourceKind: true,
	resourceId: true,
	createdBy: true,
	createdAt: true,
} as const satisfies Prisma.AuthorizationGrantSelect;

/** Prisma-generated result for the exact share projection. */
type ShareAuthorizationGrantRow = Prisma.AuthorizationGrantGetPayload<{ select: typeof _SHARE_SELECT }>;

/** Prisma enum members used without generated runtime enum exports. */
const _PRISMA_SHARE_VALUES = { Group: "Group", Principal: "Principal", Personal: "Personal", Exact: "Exact", Descendants: "Descendants" } as const;

/** Maps a stored subject and rejects inconsistent nullable foreign keys. */
function _subject(row: ShareAuthorizationGrantRow): AuthorizationSubject
{
	if (row.subjectKind === _PRISMA_SHARE_VALUES.Group && row.subjectGroupId !== null && row.subjectPrincipalId === null)
	{
		return { kind: AuthorizationSubjectKinds.Group, groupId: row.subjectGroupId };
	}
	if (row.subjectKind === _PRISMA_SHARE_VALUES.Principal && row.subjectPrincipalId !== null && row.subjectGroupId === null)
	{
		return { kind: AuthorizationSubjectKinds.Principal, principalId: row.subjectPrincipalId };
	}
	throw new Error(`share grant ${row.id} has inconsistent subject fields`);
}

/** Maps a stored boundary and rejects inconsistent nullable foreign keys. */
function _boundary(row: ShareAuthorizationGrantRow): AuthorizationBoundary
{
	if (row.boundaryKind === _PRISMA_SHARE_VALUES.Group && row.boundaryGroupId !== null && row.boundaryPrincipalId === null)
	{
		return { kind: AuthorizationBoundaryKinds.Group, groupId: row.boundaryGroupId };
	}
	if (row.boundaryKind === _PRISMA_SHARE_VALUES.Personal && row.boundaryPrincipalId !== null && row.boundaryGroupId === null)
	{
		return { kind: AuthorizationBoundaryKinds.Personal, principalId: row.boundaryPrincipalId };
	}
	throw new Error(`share grant ${row.id} has inconsistent boundary fields`);
}

/** Maps the selected authorization-owned Prisma row into the share contract. */
function _share(row: ShareAuthorizationGrantRow): ShareAuthorizationGrant
{
	return {
		id: row.id,
		subject: _subject(row),
		boundary: _boundary(row),
		boundaryCoverage: row.boundaryCoverage === _PRISMA_SHARE_VALUES.Exact ? AuthorizationBoundaryCoverages.Exact : AuthorizationBoundaryCoverages.Descendants,
		resourceKind: row.resourceKind,
		resourceId: row.resourceId,
		createdBy: row.createdBy,
		createdAt: row.createdAt,
	};
}

/** Maps a domain subject to nullable Prisma relation fields. */
function _subjectData(subject: AuthorizationSubject)
{
	if (subject.kind === AuthorizationSubjectKinds.Group)
	{
		return { subjectKind: _PRISMA_SHARE_VALUES.Group, subjectGroupId: subject.groupId, subjectPrincipalId: null };
	}
	return { subjectKind: _PRISMA_SHARE_VALUES.Principal, subjectGroupId: null, subjectPrincipalId: subject.principalId };
}

/** Maps a domain boundary to nullable Prisma relation fields. */
function _boundaryData(boundary: AuthorizationBoundary)
{
	if (boundary.kind === AuthorizationBoundaryKinds.Group)
	{
		return { boundaryKind: _PRISMA_SHARE_VALUES.Group, boundaryGroupId: boundary.groupId, boundaryPrincipalId: null };
	}
	return { boundaryKind: _PRISMA_SHARE_VALUES.Personal, boundaryGroupId: null, boundaryPrincipalId: boundary.principalId };
}

/** Maps domain coverage to the Prisma edge vocabulary. */
function _coverage(coverage: AuthorizationBoundaryCoverages): "Exact" | "Descendants"
{
	return coverage === AuthorizationBoundaryCoverages.Exact
		? _PRISMA_SHARE_VALUES.Exact
		: _PRISMA_SHARE_VALUES.Descendants;
}

/** Writes and reads grant rows used by explicit sharing relations. */
export class PrismaShareAuthorizationRepository implements ShareAuthorizationRepository
{
	/** Product-authority client shared with the surrounding transaction. */
	private readonly _prisma: Prisma.TransactionClient;

	/** Constructs the adapter around a transaction-scoped product-authority client. */
	constructor(prisma: Prisma.TransactionClient) { this._prisma = prisma; }

	/** Creates the share capability set if missing and rejects conflicting revision reuse. */
	async ensureCatalogRevision(revision: ShareCapabilityCatalogRevision): Promise<string>
	{
		const catalog = await this._prisma.capabilityCatalogRevision.upsert({
			where: { catalogId_revision: { catalogId: revision.catalogId, revision: revision.revision } },
			create: { catalogId: revision.catalogId, revision: revision.revision, digest: revision.digest, capabilities: revision.capabilities as Prisma.InputJsonValue, createdBy: revision.createdBy },
			update: {},
			select: { digest: true },
		});
		if (catalog.digest !== revision.digest) throw new Error("share capability catalog revision digest conflicts with the canonical share capability set");
		return catalog.digest;
	}

	/** Creates one exact share grant or resolves the row inserted by a concurrent request. */
	async createOrFindExactShare(input: CreateShareAuthorizationGrant): Promise<CreateOrFindShareAuthorizationGrantResult>
	{
		const existing = await this._findExactShare(input);
		if (existing !== null) return { share: existing, created: false };
		try
		{
			const created = await this._prisma.authorizationGrant.create({
				data: {
					siloId: input.siloId,
					managerId: input.managerId ?? null,
					..._subjectData(input.subject),
					..._boundaryData(input.boundary),
					boundaryCoverage: _coverage(input.boundaryCoverage),
					catalogId: input.catalogId,
					catalogRevision: input.catalogRevision,
					catalogDigest: input.catalogDigest,
					capabilityId: input.capabilityId,
					resourceKind: input.resourceKind,
					resourceId: input.resourceId,
					effect: "Allow",
					priority: input.priority,
					createdBy: input.createdByPrincipalId,
				},
				select: _SHARE_SELECT,
			});
			return { share: _share(created), created: true };
		}
		catch (error)
		{
			if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
			const concurrent = await this._findExactShare(input);
			if (concurrent === null) throw error;
			return { share: concurrent, created: false };
		}
	}

	/** Finds the live grant with the full authority coordinates that define share identity. */
	private async _findExactShare(input: CreateShareAuthorizationGrant): Promise<ShareAuthorizationGrant | null>
	{
		const row = await this._prisma.authorizationGrant.findFirst({
			where: {
				siloId: input.siloId,
				managerId: input.managerId ?? null,
				..._subjectData(input.subject),
				..._boundaryData(input.boundary),
				boundaryCoverage: _coverage(input.boundaryCoverage),
				catalogId: input.catalogId,
				catalogRevision: input.catalogRevision,
				capabilityId: input.capabilityId,
				resourceKind: input.resourceKind,
				resourceId: input.resourceId,
				effect: "Allow",
				priority: input.priority,
				revokedAt: null,
			},
			select: _SHARE_SELECT,
		});
		return row === null ? null : _share(row);
	}

	/** Lists live share grants created by one principal inside one silo. */
	async listActiveShares(siloId: string, createdBy: string, catalogId: string, capabilityId: string): Promise<readonly ShareAuthorizationGrant[]>
	{
		const rows = await this._prisma.authorizationGrant.findMany({ where: { siloId, createdBy, catalogId, capabilityId, revokedAt: null }, orderBy: { createdAt: "desc" }, select: _SHARE_SELECT });
		return rows.map(_share);
	}

	/** Soft-revokes only one exact share grant owned by the requesting principal in the silo. */
	async revokeOwnedShare(siloId: string, createdBy: string, grantId: string): Promise<boolean>
	{
		const revoked = await this._prisma.authorizationGrant.updateMany({ where: { id: grantId, siloId, createdBy, revokedAt: null }, data: { revokedAt: new Date() } });
		return revoked.count === 1;
	}

	/** Soft-revokes one grant only when the bounded manager and creating principal both own it. */
	async revokeManagedShare(siloId: string, managerId: string, createdBy: string, grantId: string): Promise<boolean>
	{
		const revoked = await this._prisma.authorizationGrant.updateMany({ where: { id: grantId, siloId, managerId, createdBy, revokedAt: null }, data: { revokedAt: new Date() } });
		return revoked.count === 1;
	}
}
