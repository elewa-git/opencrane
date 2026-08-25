import type { PrismaClient } from "@prisma/client";

import type { BoundaryGrantResolutionCommand, BoundaryGrantResolver, EffectiveBoundaryGrant } from "../boundary-attachment-authority.types";
import { PrismaBoundaryGrantRepository } from "./prisma-boundary-grant-resolver";

/** Opens one repeatable-read boundary decision transaction for management routes. */
export class PrismaBoundaryGrantUnitOfWork implements BoundaryGrantResolver
{
	/** Root client that owns transaction lifetime. */
	private readonly prisma: PrismaClient;

	/** Creates the unit of work over the app-owned Prisma client. */
	constructor(prisma: PrismaClient)
	{
		this.prisma = prisma;
	}

	/** Resolves all boundary decisions against one repeatable database snapshot. */
	async resolveEffectiveBoundaryGrants(command: BoundaryGrantResolutionCommand): Promise<readonly EffectiveBoundaryGrant[]>
	{
		return this.prisma.$transaction(async function _Resolve(transaction)
		{
			const repository = new PrismaBoundaryGrantRepository(transaction);
			return repository.resolveEffectiveBoundaryGrants(command);
		}, { isolationLevel: "RepeatableRead" });
	}
}
