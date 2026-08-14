import { AuthorizationScopeKind, Prisma } from "@prisma/client";

import { ShareAuthorizationScopeKinds, type CreateOrFindShareAuthorizationGrantResult, type CreateShareAuthorizationGrant, type ShareAuthorizationGrant, type ShareAuthorizationRepository, type ShareCapabilityCatalogRevision } from "./share-authorization-repository.types";

/** Exact persistence fields that the sharing contract may expose. */
const _SHARE_SELECT = {
	id: true,
	subjectId: true,
	scopeKind: true,
	resourceKind: true,
	resourceId: true,
	createdBy: true,
	createdAt: true,
} as const satisfies Prisma.AuthorizationGrantSelect;

/** Prisma-generated result for the exact share projection. */
type ShareAuthorizationGrantRow = Prisma.AuthorizationGrantGetPayload<{ select: typeof _SHARE_SELECT }>;

/** Prisma scope value written for each supported sharing scope. */
const _PRISMA_SCOPE_BY_SHARE: Record<ShareAuthorizationScopeKinds, AuthorizationScopeKind> = {
	[ShareAuthorizationScopeKinds.Organization]: AuthorizationScopeKind.Organization,
	[ShareAuthorizationScopeKinds.Department]: AuthorizationScopeKind.Department,
	[ShareAuthorizationScopeKinds.Project]: AuthorizationScopeKind.Project,
	[ShareAuthorizationScopeKinds.Personal]: AuthorizationScopeKind.Personal,
};

/** Maps a stored Prisma scope onto the smaller set of scopes that sharing supports. */
function _shareScopeKind(kind: AuthorizationScopeKind): ShareAuthorizationScopeKinds
{
	switch (kind)
	{
		case AuthorizationScopeKind.Organization: return ShareAuthorizationScopeKinds.Organization;
		case AuthorizationScopeKind.Department: return ShareAuthorizationScopeKinds.Department;
		case AuthorizationScopeKind.Project: return ShareAuthorizationScopeKinds.Project;
		case AuthorizationScopeKind.Personal: return ShareAuthorizationScopeKinds.Personal;
		default: throw new Error(`authorization grant scope ${kind} is not supported by sharing`);
	}
}

/** Maps the selected authorization-owned Prisma row into the share-specific contract. */
function _share(row: ShareAuthorizationGrantRow): ShareAuthorizationGrant
{
	return {
		id: row.id,
		subjectId: row.subjectId,
		scopeKind: _shareScopeKind(row.scopeKind),
		resourceKind: row.resourceKind,
		resourceId: row.resourceId,
		createdBy: row.createdBy,
		createdAt: row.createdAt,
	};
}

/**
 * Writes and reads the grant rows behind sharing.
 *
 * Takes a transaction client, not the root client, so a share can be created in the same
 * transaction as the decision that authorised it. Every method scopes to one silo, and list and
 * revoke also scope to `createdBy`.
 *
 * Constructed by: ./prisma-share-authorization-unit-of-work.ts.
 */
export class PrismaShareAuthorizationRepository implements ShareAuthorizationRepository
{
	/** Product-authority client that owns the catalog and authorization-grant tables. */
	private readonly _prisma: Prisma.TransactionClient;

	/** Constructs the adapter around the canonical product-authority client. */
	constructor(prisma: Prisma.TransactionClient)
	{
		this._prisma = prisma;
	}

	/**
	 * Creates the share capability set if it is missing, and confirms the stored one matches.
	 * @returns The stored digest, which always equals the one passed in.
	 * @throws When a revision with this number already exists with a different digest — the capability
	 *   set was changed without a new revision number, and existing shares would silently mean
	 *   something else.
	 */
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
					scopeKind: _PRISMA_SCOPE_BY_SHARE[input.scopeKind],
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

	/**
	 * Finds the grant with the exact durable-authority coordinates that define share identity.
	 *
	 * Share revocation hard-deletes the row, so this lookup deliberately does not filter on `revokedAt`.
	 */
	private async _findExactShare(input: CreateShareAuthorizationGrant): Promise<ShareAuthorizationGrant | null>
	{
		const row = await this._prisma.authorizationGrant.findFirst({
			where: {
				siloId: input.siloId,
				subjectId: input.subjectId,
				scopeKind: _PRISMA_SCOPE_BY_SHARE[input.scopeKind],
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
			select: _SHARE_SELECT,
		});
		return row === null ? null : _share(row);
	}

	/** Lists only live grants for the fixed share capability created in one exact silo. */
	async listActiveShares(siloId: string, createdBy: string, catalogId: string, capabilityId: string): Promise<readonly ShareAuthorizationGrant[]>
	{
		const rows = await this._prisma.authorizationGrant.findMany({
			where: { siloId, createdBy, catalogId, capabilityId, revokedAt: null },
			orderBy: { createdAt: "desc" },
			select: _SHARE_SELECT,
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
