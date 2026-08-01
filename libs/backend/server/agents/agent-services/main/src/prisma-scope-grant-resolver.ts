import type { Prisma, PrismaClient } from "@prisma/client";

import type { EffectiveScopeGrant, ScopeGrantResolver } from "./scope-attachment-authority.types.js";

/**
 * Stub scope-grant resolver.
 *
 * Returns an empty effective-grant set. The grant-compiler that previously backed this resolver
 * has been reaped; a follow-up wires RbacAuthority as the production source of scope grants.
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

	/** Compiles the allow-only effective knowledge-scope grants for the principal set. */
	async resolveEffectiveScopeGrants(principalIds: readonly string[]): Promise<readonly EffectiveScopeGrant[]>
	{
		void principalIds;
		return [];
	}
}
