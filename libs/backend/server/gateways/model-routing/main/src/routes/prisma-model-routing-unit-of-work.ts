import type { Prisma, PrismaClient } from "@prisma/client";

import { ___RunSerializableAuthorizationTransaction, type AuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";

import type { ModelRoutingAuthorizationFactory, ModelRoutingUnitOfWork } from "./model-routing-authorization.types";

/** Runs routing-policy operations inside the transaction that owns authorization evidence. */
export class PrismaModelRoutingUnitOfWork implements ModelRoutingUnitOfWork<Prisma.TransactionClient>
{
	/** Root client that opens one protected routing-policy transaction. */
	private readonly prisma: PrismaClient;
	/** Constructs the central authority from the operation transaction. */
	private readonly createAuthorization: ModelRoutingAuthorizationFactory<Prisma.TransactionClient> | null;

	/** Binds routing-policy operations to the product database. */
	constructor(prisma: PrismaClient, createAuthorization?: ModelRoutingAuthorizationFactory<Prisma.TransactionClient>)
	{
		this.prisma = prisma;
		this.createAuthorization = createAuthorization ?? null;
	}

	/** Runs one operation with the same transaction supplied to its central authority. */
	run<Result>(operation: (transaction: Prisma.TransactionClient, authorization: AuthorizationAuthority) => Promise<Result>): Promise<Result>
	{
		return ___RunSerializableAuthorizationTransaction(this.prisma, operation, this.createAuthorization ?? undefined);
	}
}
