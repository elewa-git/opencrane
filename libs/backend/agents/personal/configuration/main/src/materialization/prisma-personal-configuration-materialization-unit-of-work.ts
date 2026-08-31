import type { Prisma, PrismaClient } from "@prisma/client";

import { PrismaAgentRevisionModelSelectionRepository, PrismaPersonalAgentProductEffectsAuthority, type PersonalAgentProductEffects } from "@opencrane/backend/server/agents/agent-services";
import { ___RunInPrismaUnitOfWork } from "@opencrane/backend/server/infra/prisma-unit-of-work";

import type { PersonalConfigurationMaterializationTransaction, PersonalConfigurationMaterializationUnitOfWork, PersonalConfigurationMaterializationWork } from "./personal-configuration-materialization-unit-of-work.types";
import { PrismaPersonalConfigurationMaterializationRepository } from "./prisma-personal-configuration-materialization";

/** Prisma/PostgreSQL conflict codes that are safe to retry because the transaction rolled back. */
const _RETRYABLE_MATERIALIZATION_CODES: ReadonlySet<string> = new Set(["P0001", "P2002", "P2004", "P2034"]);

/** Test seam that still returns a product-effect adapter bound to the supplied transaction. */
type _PersonalAgentProductEffectsFactory = (transaction: Prisma.TransactionClient) => PersonalAgentProductEffects;

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
	/** Optional factory used by focused tests to observe central effect admission. */
	private readonly createProductEffects: _PersonalAgentProductEffectsFactory | null;

	/** Creates the Prisma-backed unit of work. */
	constructor(prisma: PrismaClient, createProductEffects: _PersonalAgentProductEffectsFactory | null = null)
	{
		this.prisma = prisma;
		this.createProductEffects = createProductEffects;
	}

	/**
	 * Runs the whole operation in one Serializable transaction, retrying it when it is safe to.
	 *
	 * The shared unit-of-work envelope allows three complete attempts. Every retry builds both
	 * repositories again, so no half-written revision or proposal state survives a P0001, P2002,
	 * P2004 or P2034 rollback — all four mean PostgreSQL discarded the transaction, which is why
	 * they are the only codes retried.
	 *
	 * @param work - Runs once per attempt, so it must be safe to repeat.
	 * @returns Whatever the work returned on the attempt that committed.
	 * @throws Error for any other failure, and for a retryable conflict still present after the
	 * third attempt, so {@link _PersonalConfigurationMaterializer} can log it once and return
	 * `PersistenceUnavailable`.
	 */
	async run<Result>(work: PersonalConfigurationMaterializationWork<Result>): Promise<Result>
	{
		const createProductEffects = this.createProductEffects;
		// Build both repositories on one transaction, so neither can commit without the other.
		return ___RunInPrismaUnitOfWork(this.prisma, async function _RunTransaction(transaction): Promise<Result>
		{
			const productEffects = createProductEffects === null ? new PrismaPersonalAgentProductEffectsAuthority(transaction) : createProductEffects(transaction);
			const repositories: PersonalConfigurationMaterializationTransaction = {
				proposals: new PrismaPersonalConfigurationMaterializationRepository(transaction),
				agentRevisions: new PrismaAgentRevisionModelSelectionRepository(transaction, productEffects),
			};
			return work(repositories);
		}, { isolationLevel: "Serializable", operation: "personal configuration materialization", attemptLimit: 3, retryableCodes: _RETRYABLE_MATERIALIZATION_CODES });
	}
}
