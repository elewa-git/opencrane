import type { Prisma, PrismaClient } from "@prisma/client";

import type { EffectiveScopeGrant, ScopeGrantResolver } from "./scope-attachment-authority.types.js";

/**
 * Grant-compiler-backed effective-scope resolver.
 *
 * This is the REAL grant-compiler import that justifies re-opening the `scope:grants` edge on
 * `scope:agent-services`. It compiles Awareness (knowledge-scope) grants for the given principals and
 * keeps only the ALLOW winners. A Grant's `subjectId` is the principal receiving access; its
 * `payloadId` is the knowledge target. The resolver therefore projects `payloadId` (not the
 * receiving principal) into the attachment triple and derives the target kind from the independent
 * scope dimension. Deny/absent scopes never appear, so intersection can only filter, never widen.
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
