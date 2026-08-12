import { AgentServiceKind, ConversationMode, Prisma, type Prisma as PrismaTypes } from "@prisma/client";

import { PersonalConfigurationProposalCodes, type ProposePersonalConfigurationChangeCommand } from "./personal-configuration-proposal.types.js";
import type { PersonalConfigurationProposalPersistenceResult, PersonalConfigurationProposalRepository } from "./personal-configuration-proposal-unit-of-work.types.js";

/** Checks that a proposal's sources belong to the caller, then inserts it, all in one transaction. */
export class PrismaPersonalConfigurationProposalRepository implements PersonalConfigurationProposalRepository
{
	/** Transaction-scoped client supplied by the proposal unit of work. */
	private readonly transaction: PrismaTypes.TransactionClient;

	/** Creates the proposal repository over one transaction snapshot. */
	constructor(transaction: PrismaTypes.TransactionClient)
	{
		this.transaction = transaction;
	}

	/** Checks the profile, conversation, run, and service before inserting the proposal. */
	async propose(command: ProposePersonalConfigurationChangeCommand): Promise<PersonalConfigurationProposalPersistenceResult>
	{
		// 1. Check the persona profile belongs to this user and silo, and read its active revision.
		const profile = await this.transaction.personaProfile.findFirst({ where: { id: command.personaProfileId, siloId: command.siloId, userId: command.userId }, select: { activeRevisionId: true } });
		if (profile === null) return { status: PersonalConfigurationProposalCodes.ProvenanceConflict };

		// 2. Check the conversation, run, and personal service belong to the same user and silo.
		const conversation = await this.transaction.conversation.findFirst({ where: { id: command.sourceConversationId, siloId: command.siloId, mode: ConversationMode.AgentSession, participants: { some: { userId: command.userId, accessEndedPosition: null } } }, select: { agentServiceId: true } });
		const run = await this.transaction.agentRun.findFirst({ where: { id: command.sourceRunId, siloId: command.siloId, conversationId: command.sourceConversationId, agentServiceId: command.agentServiceId, delegatedUserId: command.userId }, select: { id: true } });
		const service = await this.transaction.agentService.findFirst({ where: { id: command.agentServiceId, siloId: command.siloId, kind: AgentServiceKind.Personal }, select: { activeRevisionId: true } });
		if (conversation === null || conversation.agentServiceId !== command.agentServiceId || run === null || service === null || profile.activeRevisionId !== command.expectedPersonaRevisionId || service.activeRevisionId !== command.expectedAgentRevisionId)
		{
			return { status: PersonalConfigurationProposalCodes.ProvenanceConflict };
		}

		// 3. Store the request only; the owner decides later, and materialisation happens after that.
		const change = await this.transaction.personalConfigurationChange.create({ data: { siloId: command.siloId, userId: command.userId, personaProfileId: command.personaProfileId, agentServiceId: command.agentServiceId, sourceConversationId: command.sourceConversationId, sourceRunId: command.sourceRunId, sourceMessageId: command.sourceMessageId, requestedPatch: command.requestedPatch as Prisma.InputJsonValue, requestedPatchDigest: command.requestedPatchDigest, expectedPersonaRevisionId: command.expectedPersonaRevisionId, expectedAgentRevisionId: command.expectedAgentRevisionId, proposedAt: new Date(command.proposedAt) }, select: { id: true } });
		return { status: PersonalConfigurationProposalCodes.Proposed, changeId: change.id };
	}
}
