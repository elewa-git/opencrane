import { Prisma } from "@prisma/client";

import type { CreateOrFindShareAuthorizationGrantResult, CreateShareAuthorizationGrant, ShareAuthorizationGrant, ShareAuthorizationRepository, ShareCapabilityCatalogRevision } from "./share-authorization-repository.types.js";

/** Maps the authorization-owned Prisma row into the share-specific persistence contract. */
function _share(row: { id: string; siloId: string; subjectId: string; scopeKind: string; organizationId: string; catalogId: string; catalogRevision: number; catalogDigest: string; capabilityId: string; resourceKind: string; resourceId: string; createdBy: string; createdAt: Date }): ShareAuthorizationGrant
{
	return {
		id: row.id,
		siloId: row.siloId,
		subjectId: row.subjectId,
		scopeKind: row.scopeKind,
		organizationId: row.organizationId,
		catalogId: row.catalogId,
		catalogRevision: row.catalogRevision,
		catalogDigest: row.catalogDigest,
		capabilityId: row.capabilityId,
		resourceKind: row.resourceKind,
		resourceId: row.resourceId,
		createdBy: row.createdBy,
		createdAt: row.createdAt,
	};
}

/** Prisma adapter that owns the authorization rows required by the sharing capability. */
export class PrismaShareAuthorizationRepository implements ShareAuthorizationRepository
{
	/** Canonical product-authority client that owns catalog and authorization-grant delegates. */
	private readonly _prisma: Prisma.TransactionClient;

	/** Constructs the adapter around the canonical product-authority client. */
	constructor(prisma: Prisma.TransactionClient)
	{
		this._prisma = prisma;
	}

	/** Creates the fixed share catalog revision once and returns its canonical stored digest. */
	async ensureCatalogRevision(revision: ShareCapabilityCatalogRevision): Promise<string>
	{
		const catalog = await this._prisma.capabilityCatalogRevision.upsert({
			where: { catalogId_revision: { catalogId: revision.catalogId, revision: revision.revision } },
			create: {
				catalogId: revision.catalogId,
				revision: revision.revision,
				digest: revision.digest,
				capabilities: revision.capabilities as Prisma.InputJsonValue,
				createdBy: revision.createdBy,
			},
			update: {},
			select: { digest: true },
		});
		if (catalog.digest !== revision.digest)
		{
			throw new Error("share capability catalog revision digest conflicts with the canonical share capability set");
		}
		return catalog.digest;
	}

	/** Creates one share or resolves the durable exact-authority row after a concurrent insert wins. */
	async createOrFindExactShare(input: CreateShareAuthorizationGrant): Promise<CreateOrFindShareAuthorizationGrantResult>
	{
		const existing = await this._findExactShare(input);
		if (existing !== null) return { share: existing, created: false };
		try
		{
			const created = await this._prisma.authorizationGrant.create({
				data: {
					siloId: input.siloId,
					subjectId: input.subjectId,
					scopeKind: input.scopeKind as never,
					organizationId: input.organizationId,
					scopeResourceId: null,
					catalogId: input.catalogId,
					catalogRevision: input.catalogRevision,
					catalogDigest: input.catalogDigest,
					capabilityId: input.capabilityId,
					resourceKind: input.resourceKind,
					resourceId: input.resourceId,
					effect: "Allow",
					priority: input.priority,
					createdBy: input.createdBy,
				},
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

	/**
	 * Finds the grant with the exact durable-authority coordinates that define share identity.
	 *
	 * Share revocation hard-deletes the row, so this lookup deliberately has no `revokedAt` predicate.
	 */
	private async _findExactShare(input: CreateShareAuthorizationGrant): Promise<ShareAuthorizationGrant | null>
	{
		const row = await this._prisma.authorizationGrant.findFirst({
			where: {
				siloId: input.siloId,
				subjectId: input.subjectId,
				scopeKind: input.scopeKind as never,
				organizationId: input.organizationId,
				scopeResourceId: null,
				catalogId: input.catalogId,
				catalogRevision: input.catalogRevision,
				capabilityId: input.capabilityId,
				resourceKind: input.resourceKind,
				resourceId: input.resourceId,
				effect: "Allow",
				priority: input.priority,
			},
		});
		return row === null ? null : _share(row);
	}

	/** Lists only live grants for the fixed share capability created in one exact silo. */
	async listActiveShares(siloId: string, createdBy: string, catalogId: string, capabilityId: string): Promise<readonly ShareAuthorizationGrant[]>
	{
		const rows = await this._prisma.authorizationGrant.findMany({
			where: { siloId, createdBy, catalogId, capabilityId, revokedAt: null },
			orderBy: { createdAt: "desc" },
		});
		return rows.map(function _mapShare(row)
		{
			return _share(row);
		});
	}

	/** Revokes only an exact grant owned by the requesting principal inside the same silo. */
	async revokeOwnedShare(siloId: string, createdBy: string, grantId: string): Promise<boolean>
	{
		const deleted = await this._prisma.authorizationGrant.deleteMany({ where: { id: grantId, siloId, createdBy } });
		return deleted.count === 1;
	}
}
