import type { PrismaClient } from "@prisma/client";

import { PrismaAuthorizationGrantRepository } from "./prisma-authorization-grants.js";
import { PrismaShareAuthorizationRepository } from "./prisma-share-authorization-repository.js";
import type { ShareAuthorizationTransaction, ShareAuthorizationUnitOfWork } from "./share-authorization-unit-of-work.types.js";

/**
 * Runs one share procedure with both repositories on the same transaction.
 *
 * The grant read that authorises a share and the grant write that creates it must not straddle two
 * transactions, or a revoked permission could still produce a share.
 *
 * Called by: libs/backend/server/iam/grants/main/src/routes/shares.ts.
 */
export class PrismaShareAuthorizationUnitOfWork implements ShareAuthorizationUnitOfWork
{
	/** Product-authority client that starts share transactions. */
	private readonly _prisma: PrismaClient;

	/** Constructs the unit of work around the application-composed authority client. */
	constructor(prisma: PrismaClient)
	{
		this._prisma = prisma;
	}

	/** Executes one procedure through transaction-scoped grant and share repositories. */
	async execute<Result>(procedure: (transaction: ShareAuthorizationTransaction) => Promise<Result>): Promise<Result>
	{
		return this._prisma.$transaction(async (transaction): Promise<Result> =>
		{
			return procedure({
				grantRepository: new PrismaAuthorizationGrantRepository(transaction),
				shareRepository: new PrismaShareAuthorizationRepository(transaction),
			});
		});
	}
}
