import { Prisma, type PrismaClient } from "@prisma/client";

import { PrismaAgentRevisionModelSelectionRepository } from "@opencrane/backend/server/agents/agent-services";

import type { PersonalConfigurationMaterializationTransaction, PersonalConfigurationMaterializationUnitOfWork, PersonalConfigurationMaterializationWork } from "./personal-configuration-materialization-unit-of-work.types.js";
import { PrismaPersonalConfigurationMaterializationRepository } from "./prisma-personal-configuration-materialization.js";

/** How many times the whole operation may be attempted when a conflict rolls it back. */
const _MATERIALIZATION_ATTEMPT_LIMIT = 3;

/** Prisma/PostgreSQL conflict codes that are safe to retry because the transaction rolled back. */
const _RETRYABLE_MATERIALIZATION_CODES = new Set(["P0001", "P2002", "P2004", "P2034"]);

/**
 * Opens the Serializable transaction in which the proposal and the agent revision both change.
 *
 * Owns isolation and retries so the materialiser can concentrate on the order of writes.
 *
 * Constructed by: `_CreatePersonalConfigurationRouter`.
 *
 * @implements PersonalConfigurationMaterializationUnitOfWork
 */
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
	 * Runs the whole operation in one Serializable transaction, retrying it when it is safe to.
	 *
	 * Every retry builds both repositories again, so no half-written revision or proposal state
	 * survives a P0001, P2002, P2004 or P2034 rollback — all four mean PostgreSQL discarded the
	 * transaction, which is why they are the only codes retried.
	 *
	 * @param work - Runs once per attempt, so it must be safe to repeat.
	 * @returns Whatever the work returned on the attempt that committed.
	 * @throws Error for any other failure, and for a retryable conflict still present after the
	 * third attempt, so {@link _PersonalConfigurationMaterializer} can log it once and return
	 * `PersistenceUnavailable`.
	 */
	async run<Result>(work: PersonalConfigurationMaterializationWork<Result>): Promise<Result>
	{
		for (let attempt = 1; attempt <= _MATERIALIZATION_ATTEMPT_LIMIT; attempt += 1)
		{
			try
			{
				// 1. Build both repositories on one transaction, so neither can commit without the other.
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
				// 2. Retry only the conflicts that rolled the transaction back, and only while attempts remain.
				if (_IsRetryableMaterializationConflict(error) && attempt < _MATERIALIZATION_ATTEMPT_LIMIT) continue;

				// 3. Rethrow the last error so the materialiser logs and translates it once.
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
