import { Prisma } from "@prisma/client";

import type { PersonalConfigurationProposalPersistenceReceipt, PersonalConfigurationProposalRepository } from "./personal-configuration-proposal-repository.types.js";
import type { ProposePersonalConfigurationChangeCommand } from "./personal-configuration-proposal.types.js";

/** Prisma insert adapter for database-guarded personal configuration proposals. */
export class PrismaPersonalConfigurationProposalRepository implements PersonalConfigurationProposalRepository
{
	/** Transaction-scoped client supplied by the proposal unit of work. */
	private readonly transaction: Prisma.TransactionClient;

	/** Creates the proposal repository over one transaction snapshot. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/** Insert immutable evidence through the locking database provenance trigger. */
	async propose(command: ProposePersonalConfigurationChangeCommand): Promise<PersonalConfigurationProposalPersistenceReceipt>
	{
		const change = await this.transaction.personalConfigurationChange.create(_proposalCreate(command));
		return _receipt(change.id);
	}
}

/** Initializes the immutable proposal insert that invokes the locking provenance trigger. */
function _proposalCreate(command: ProposePersonalConfigurationChangeCommand): Prisma.PersonalConfigurationChangeCreateArgs
{
	const query: Prisma.PersonalConfigurationChangeCreateArgs = {
		data: {
			siloId: command.siloId,
			userId: command.userId,
			personaProfileId: command.personaProfileId,
			agentServiceId: command.agentServiceId,
			sourceConversationId: command.sourceConversationId,
			sourceRunId: command.sourceRunId,
			sourceMessageId: command.sourceMessageId,
			requestedPatch: command.requestedPatch as Prisma.InputJsonValue,
			requestedPatchDigest: command.requestedPatchDigest,
			expectedPersonaRevisionId: command.expectedPersonaRevisionId,
			expectedAgentRevisionId: command.expectedAgentRevisionId,
			proposedAt: new Date(command.proposedAt),
		},
		select: { id: true },
	};
	return query;
}

/** Returns the durable receipt for one database-admitted proposal journal row. */
function _receipt(changeId: string): PersonalConfigurationProposalPersistenceReceipt
{
	const receipt: PersonalConfigurationProposalPersistenceReceipt = { changeId };
	return receipt;
}
