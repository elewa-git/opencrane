import type { Prisma, PrismaClient } from "@prisma/client";

import { PrismaAuthorizationAuthority, ___RunSerializableAuthorizationTransaction, type AuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";

import type { ProviderGatewayAuthorizationFactory, ProviderGatewayUnitOfWork } from "./provider-gateway-authority.types";

/** Runs provider and model operations inside the transaction that owns authorization evidence. */
export class PrismaProviderGatewayUnitOfWork implements ProviderGatewayUnitOfWork<Prisma.TransactionClient>
{
	/** Root client that opens one protected operation transaction. */
	private readonly prisma: PrismaClient;
	/** Constructs the central authority from the operation transaction. */
	private readonly createAuthorization: ProviderGatewayAuthorizationFactory<Prisma.TransactionClient> | null;

	/** Binds provider and model operations to the product database. */
	constructor(prisma: PrismaClient, createAuthorization?: ProviderGatewayAuthorizationFactory<Prisma.TransactionClient>)
	{
		this.prisma = prisma;
		this.createAuthorization = createAuthorization ?? null;
	}

	/** Runs one operation that may contain an external effect without retrying the callback. */
	run<Result>(operation: (transaction: Prisma.TransactionClient, authorization: AuthorizationAuthority) => Promise<Result>): Promise<Result>
	{
		const createAuthorization = this.createAuthorization;
		return this.prisma.$transaction(async function _Run(transaction): Promise<Result>
		{
			const authorization = createAuthorization === null ? new PrismaAuthorizationAuthority(transaction) : createAuthorization(transaction);
			return operation(transaction, authorization);
		});
	}

	/** Runs one database-only protected mutation with bounded Serializable conflict retries. */
	runDatabaseMutation<Result>(operation: (transaction: Prisma.TransactionClient, authorization: AuthorizationAuthority) => Promise<Result>): Promise<Result>
	{
		return ___RunSerializableAuthorizationTransaction(this.prisma, operation, this.createAuthorization ?? undefined);
	}
}
