import { Prisma, type PrismaClient } from "@prisma/client";

import { PrismaProviderEffectCommandRepository } from "./prisma-provider-effect-command-repository";
import type { ProviderEffectCommandRepository, ProviderEffectCommandUnitOfWork } from "./provider-effect-command.types";

/** Number of times a short delivery-state transaction may restart after a serialization conflict. */
const _MAX_SERIALIZABLE_ATTEMPTS = 3;

/**
 * Opens short Serializable transactions for provider-command claims and finalization.
 *
 * The executor calls this before and after external I/O, never around it. A PostgreSQL serialization
 * conflict restarts the database operation at most three times; every other error reaches the caller.
 *
 * Called by: {@link DefaultProviderEffectCommandExecutor}.
 */
export class PrismaProviderEffectCommandUnitOfWork implements ProviderEffectCommandUnitOfWork
{
	/** Root Prisma client that opens delivery-state transactions. */
	private readonly prisma: PrismaClient;

	/**
	 * Binds provider-command delivery to the product database.
	 *
	 * @param prisma - Root Prisma client used only to open transactions.
	 */
	constructor(prisma: PrismaClient)
	{
		this.prisma = prisma;
	}

	/** @inheritdoc */
	async run<Result>(operation: (repository: ProviderEffectCommandRepository) => Promise<Result>): Promise<Result>
	{
		for (let attempt = 1; attempt <= _MAX_SERIALIZABLE_ATTEMPTS; attempt += 1)
		{
			try
			{
				return await this.prisma.$transaction(async function _Run(transaction): Promise<Result>
				{
					const repository = new PrismaProviderEffectCommandRepository(transaction);
					return operation(repository);
				}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
			}
			catch (error)
			{
				if (!_isSerializationConflict(error) || attempt === _MAX_SERIALIZABLE_ATTEMPTS)
					throw error;
			}
		}
		throw new Error("provider effect transaction retry budget ended without an outcome");
	}
}

/** Return true only for Prisma's retryable transaction-conflict code. */
function _isSerializationConflict(error: unknown): boolean
{
	return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
}
