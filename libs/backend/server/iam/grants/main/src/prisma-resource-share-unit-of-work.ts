import type { PrismaClient } from "@prisma/client";

import { PrismaManagedAuthorizationGrantRepository, PrismaShareAuthorizationRepository, ___RunSerializableAuthorizationTransaction } from "@opencrane/backend/server/iam/authorization";
import { PrismaResourceShareRepository } from "./prisma-resource-share-repository";
import type { ResourceShareTransaction, ResourceShareUnitOfWork } from "./resource-share-unit-of-work.types";

/** Opens the transaction that contains each complete resource-sharing command. */
export class PrismaResourceShareUnitOfWork implements ResourceShareUnitOfWork
{
	/** Root product-authority client that may start transactions. */
	private readonly _prisma: PrismaClient;

	/** Creates the unit of work at the application composition boundary. */
	constructor(prisma: PrismaClient) { this._prisma = prisma; }

	/** Executes one procedure with all authority adapters bound to the same transaction. */
	async execute<Result>(procedure: (transaction: ResourceShareTransaction) => Promise<Result>): Promise<Result>
	{
		return ___RunSerializableAuthorizationTransaction(this._prisma, async function _ResourceShareTransaction(transaction, authorization): Promise<Result>
		{
			return procedure({
				authorization,
				authorizationShares: new PrismaShareAuthorizationRepository(transaction),
				managedAuthorizationGrants: new PrismaManagedAuthorizationGrantRepository(transaction),
				resourceShares: new PrismaResourceShareRepository(transaction),
			});
		});
	}
}
