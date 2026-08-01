import { PersonalConfigurationChangeState, Prisma, type PrismaClient } from "@prisma/client";

import { AgentConfigPatchKinds } from "@opencrane/contracts";

import { PersonalConfigurationPersonaRefreshClaimCodes, type AcceptedPersonaRefreshCommand, type PersonalConfigurationPersonaRefreshRepository, type PersonalConfigurationPersonaRefreshUnitOfWork } from "./personal-configuration-persona-refresh.types.js";

/** Configuration-owned Prisma unit of work for a persona-refresh proposal and its persona revision. */
export class PrismaPersonalConfigurationPersonaRefreshUnitOfWork implements PersonalConfigurationPersonaRefreshUnitOfWork
{
	/** Canonical product-authority database client. */
	private readonly prisma: PrismaClient;

	/** Creates the configuration-owned transaction boundary. */
	constructor(prisma: PrismaClient)
	{
		this.prisma = prisma;
	}

	/**
	 * Runs persona work with a transaction-scoped configuration proposal repository.
	 *
	 * PostgreSQL Serializable isolation makes the callback's accepted proposal,
	 * persona mutations, and applied state one all-or-nothing commit. Concurrent
	 * refresh or approval writers that invalidate this snapshot fail with a
	 * serialization error, which the owning persona authority must translate to
	 * its explicit conflict outcome rather than retrying or partially applying.
	 */
	async runPersonaRefresh<Result>(work: (transaction: unknown, refreshes: PersonalConfigurationPersonaRefreshRepository) => Promise<Result>): Promise<Result>
	{
		return this.prisma.$transaction(async function _runPersonaRefresh(transaction): Promise<Result>
		{
			return work(transaction, new _PrismaPersonalConfigurationPersonaRefreshRepository(transaction));
		}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
	}
}

/** Transaction-scoped configuration repository that owns all PersonalConfigurationChange state access. */
class _PrismaPersonalConfigurationPersonaRefreshRepository implements PersonalConfigurationPersonaRefreshRepository
{
	/** Transaction that bounds persona and configuration mutations together. */
	private readonly transaction: Prisma.TransactionClient;

	/** Binds proposal operations to one configuration-owned transaction. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/** Locks and verifies the exact accepted persona-refresh proposal. */
	async claimAcceptedPersonaRefresh(command: AcceptedPersonaRefreshCommand): Promise<PersonalConfigurationPersonaRefreshClaimCodes>
	{
		const change = await this.transaction.personalConfigurationChange.findFirst({
			where: {
				id: command.configurationChangeId,
				siloId: command.siloId,
				userId: command.userId,
				personaProfileId: command.personaProfileId,
				state: PersonalConfigurationChangeState.Accepted,
				requestedPatch: { equals: { kind: AgentConfigPatchKinds.PersonaRefresh } },
			},
			select: { id: true },
		});
		return change === null ? PersonalConfigurationPersonaRefreshClaimCodes.Unavailable : PersonalConfigurationPersonaRefreshClaimCodes.Accepted;
	}

	/** Applies only the still-accepted persona-refresh proposal attached to the approved revision. */
	async applyApprovedPersonaRefresh(command: AcceptedPersonaRefreshCommand & { readonly personaRevisionId: string }): Promise<boolean>
	{
		const updated = await this.transaction.personalConfigurationChange.updateMany({
			where: {
				id: command.configurationChangeId,
				siloId: command.siloId,
				userId: command.userId,
				personaProfileId: command.personaProfileId,
				state: PersonalConfigurationChangeState.Accepted,
				requestedPatch: { equals: { kind: AgentConfigPatchKinds.PersonaRefresh } },
			},
			data: {
				state: PersonalConfigurationChangeState.Applied,
				appliedPersonaRevisionId: command.personaRevisionId,
			},
		});
		return updated.count === 1;
	}
}
