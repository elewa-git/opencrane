import { Prisma, type PrismaClient } from "@prisma/client";
import { PrismaAuthorizationAuthority, type AuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";

import { PrismaProviderEffectCommandRepository } from "./prisma-provider-effect-command-repository";
import type { ProviderEffectCommandRepository, ProviderEffectCommandUnitOfWork } from "./provider-effect-command.types";

/** Number of times a short delivery-state transaction may restart after a serialization conflict. */
const _MAX_SERIALIZABLE_ATTEMPTS = 3;
/** Named first-writer constraints whose rollback loser may safely reread the global winner. */
const _RETRYABLE_UNIQUE_CONSTRAINTS = ["model_routing_defaults_global_key", "model_definitions_global_public_model_name_key"] as const;

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
	async run<Result>(operation: (repository: ProviderEffectCommandRepository, authorization: AuthorizationAuthority) => Promise<Result>): Promise<Result>
	{
		for (let attempt = 1; attempt <= _MAX_SERIALIZABLE_ATTEMPTS; attempt += 1)
		{
			try
			{
				return await this.prisma.$transaction(async function _Run(transaction): Promise<Result>
				{
					const repository = new PrismaProviderEffectCommandRepository(transaction);
					const authorization = new PrismaAuthorizationAuthority(transaction);
					return operation(repository, authorization);
				}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
			}
			catch (error)
			{
				if (!_isRetryableConflict(error) || attempt === _MAX_SERIALIZABLE_ATTEMPTS)
					throw error;
			}
		}
		throw new Error("provider effect transaction retry budget ended without an outcome");
	}
}

/** Returns true for serialization loss or the two first-writer global alias insert races. */
function _isRetryableConflict(error: unknown): boolean
{
	if (!(error instanceof Prisma.PrismaClientKnownRequestError))
		return false;
	if (error.code === "P2034")
		return true;
	if (error.code !== "P2002")
		return false;
	const target = error.meta?.target;
	const targets = Array.isArray(target) ? target.map(String) : [String(target ?? "")];
	return _RETRYABLE_UNIQUE_CONSTRAINTS.some(function _Matches(constraint)
	{
		return targets.includes(constraint) || error.message.includes(constraint);
	});
}
