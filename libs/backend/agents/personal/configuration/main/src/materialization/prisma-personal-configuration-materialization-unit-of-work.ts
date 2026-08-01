import { Prisma, type PrismaClient } from "@prisma/client";

import { PrismaAgentRevisionModelSelectionRepository } from "@opencrane/backend/server/agents/agent-services";

import type { PersonalConfigurationMaterializationTransaction, PersonalConfigurationMaterializationUnitOfWork, PersonalConfigurationMaterializationWork } from "./personal-configuration-materialization-unit-of-work.types.js";
import { PrismaPersonalConfigurationMaterializationRepository } from "./prisma-personal-configuration-materialization.js";

/** Maximum complete unit-of-work attempts used to resolve expected concurrency conflicts. */
const _MATERIALIZATION_ATTEMPT_LIMIT = 3;

/** Prisma/PostgreSQL conflict codes that are safe to retry because the transaction rolled back. */
const _RETRYABLE_MATERIALIZATION_CODES = new Set(["P0001", "P2002", "P2004", "P2034"]);

/** Prisma implementation of the cross-domain personal materialisation unit of work. */
export class PrismaPersonalConfigurationMaterializationUnitOfWork implements PersonalConfigurationMaterializationUnitOfWork
{
	/** Canonical product-authority database client. */
	private readonly prisma: PrismaClient;

	/** Creates the Prisma-backed unit of work. */
	constructor(prisma: PrismaClient)
	{
		this.prisma = prisma;
	}

	/**
	 * Runs the complete cross-domain operation in one retry-safe serializable transaction.
	 *
	 * Each retry reconstructs both transaction-scoped repositories, ensuring no partial revision or
	 * proposal state survives P0001, P2002, P2004, or P2034. Unexpected errors and an exhausted
	 * attempt budget propagate to the application materializer for stable result translation.
	 */
	async run<Result>(work: PersonalConfigurationMaterializationWork<Result>): Promise<Result>
	{
		for (let attempt = 1; attempt <= _MATERIALIZATION_ATTEMPT_LIMIT; attempt += 1)
		{
			try
			{
				// 1. Bind both capability repositories to one transaction so neither can commit alone.
				return await this.prisma.$transaction(async function _RunTransaction(transaction): Promise<Result>
				{
					const repositories: PersonalConfigurationMaterializationTransaction = {
						proposals: new PrismaPersonalConfigurationMaterializationRepository(transaction),
						agentRevisions: new PrismaAgentRevisionModelSelectionRepository(transaction),
					};
					return work(repositories);
				}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
			}
			catch (error)
			{
				// 2. Retry only known rolled-back conflicts while a complete fresh attempt remains.
				if (_IsRetryableMaterializationConflict(error) && attempt < _MATERIALIZATION_ATTEMPT_LIMIT) continue;

				// 3. Preserve the final error so the application boundary can log and translate it once.
				throw error;
			}
		}
		throw new Error("personal configuration materialization exhausted without a result");
	}
}

/** Returns whether Prisma confirms that the complete transaction rolled back after a race. */
function _IsRetryableMaterializationConflict(error: unknown): boolean
{
	return error instanceof Prisma.PrismaClientKnownRequestError && _RETRYABLE_MATERIALIZATION_CODES.has(error.code);
}
