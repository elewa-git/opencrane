import { Prisma, type PrismaClient } from "@prisma/client";

import type { PrismaAuthorizationTransactionAuthorityFactory, PrismaAuthorizationTransactionRunner, PrismaAuthorizationTransactionWork } from "./prisma-authorization-transaction.types";
import { PrismaAuthorizationAuthority } from "./prisma-authorization-authority";

/** Maximum complete attempts after PostgreSQL rolls back a Serializable authorization transaction. */
const _AUTHORIZATION_TRANSACTION_ATTEMPT_LIMIT = 3;

/**
 * Runs database-only authorization reads, the protected write, and audit evidence in one
 * Serializable transaction.
 *
 * A Prisma P2034 proves PostgreSQL rolled the entire attempt back, so the function may safely create
 * a fresh transaction and authority and repeat the complete idempotent operation. No other failure
 * is retried, and the third P2034 is rethrown unchanged for the owning route to translate. Callers
 * must never place an effect that can survive database rollback inside `work`.
 *
 * Called by: product-domain UnitOfWorks that bind central authorization to a database-only mutation.
 * @see PrismaAuthorizationAuthority for the transaction-scoped decision adapter.
 */
export function ___RunSerializableAuthorizationTransaction<Result>(prisma: PrismaClient, work: PrismaAuthorizationTransactionWork<Prisma.TransactionClient, Result>, createAuthorization?: PrismaAuthorizationTransactionAuthorityFactory<Prisma.TransactionClient>): Promise<Result>
{
	const unitOfWork = new PrismaAuthorizationTransactionUnitOfWork(prisma);
	return unitOfWork.run(work, createAuthorization);
}

/** Owns the direct Prisma transaction behind the shared database-only retry policy. */
class PrismaAuthorizationTransactionUnitOfWork implements PrismaAuthorizationTransactionRunner<Prisma.TransactionClient>
{
	/** Root product client used only to open fresh transaction attempts. */
	private readonly prisma: PrismaClient;

	/** Stores the root product client that opens each protected attempt. */
	constructor(prisma: PrismaClient)
	{
		this.prisma = prisma;
	}

	/** @inheritdoc */
	async run<Result>(work: PrismaAuthorizationTransactionWork<Prisma.TransactionClient, Result>, createAuthorization?: PrismaAuthorizationTransactionAuthorityFactory<Prisma.TransactionClient>): Promise<Result>
	{
		for (let attempt = 1; attempt <= _AUTHORIZATION_TRANSACTION_ATTEMPT_LIMIT; attempt += 1)
		{
			try
			{
				return await this.prisma.$transaction(async function _Run(transaction): Promise<Result>
				{
					const authorization = createAuthorization === undefined ? new PrismaAuthorizationAuthority(transaction) : createAuthorization(transaction);
					return work(transaction, authorization);
				}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
			}
			catch (error)
			{
				if (!_IsSerializationConflict(error) || attempt === _AUTHORIZATION_TRANSACTION_ATTEMPT_LIMIT)
				{
					throw error;
				}
			}
		}
		throw new Error("authorization transaction exhausted without a result");
	}
}

/** Returns whether Prisma confirms that PostgreSQL rolled the complete transaction back. */
function _IsSerializationConflict(error: unknown): boolean
{
	return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
}
