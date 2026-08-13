import type { Prisma, PrismaClient } from "@prisma/client";

import type { EffectiveScopeGrant, ScopeGrantResolver } from "./scope-attachment-authority.types.js";

/**
 * Not implemented yet — always returns no grants.
 *
 * The grant compiler that used to back this was removed and RbacAuthority has not been wired in. The
 * consequence is not neutral: with no grants, every declared scope attachment is rejected, so
 * authoring a revision with any attachment is refused with 403 `FORBIDDEN_SCOPE_ATTACHMENT`, and
 * admitting a managed run whose revision has any attachment is denied `memory_scope_unavailable`.
 * Revisions with no attachments are unaffected. Failing closed like this is the right direction for
 * a missing authorisation source, but it is a stub, not the finished behaviour.
 *
 * Called by: injected as `scopeGrantResolver` in `prisma-agent-services.router.ts`, and constructed
 * inline by `PrismaManagedExecutionEvidenceAuthority.load` in
 * `prisma-managed-execution-evidence.ts`.
 */
export class PrismaScopeGrantResolver implements ScopeGrantResolver
{
	/** OpenCrane product-authority database client. */
	private readonly prisma: PrismaClient | Prisma.TransactionClient;

	/**
	 * Creates a resolver over canonical Postgres.
	 * @param prisma - OpenCrane Prisma client.
	 */
	constructor(prisma: PrismaClient | Prisma.TransactionClient)
	{
		this.prisma = prisma;
	}

	/** Always returns an empty list; see the note on the class. The `prisma` field and `principalIds` are unused until a real grant source is wired in. */
	async resolveEffectiveScopeGrants(principalIds: readonly string[]): Promise<readonly EffectiveScopeGrant[]>
	{
		void principalIds;
		return [];
	}
}
