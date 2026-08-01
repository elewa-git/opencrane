import { AgentServiceKind, Prisma, type Prisma as PrismaTypes } from "@prisma/client";

import { PersonalConfigurationProposalCodes, type ProposePersonalConfigurationChangeCommand } from "./personal-configuration-proposal.types.js";
import type { PersonalConfigurationProposalPersistenceResult, PersonalConfigurationProposalRepository } from "./personal-configuration-proposal-unit-of-work.types.js";

/** Prisma repository that proves proposal provenance inside its owning transaction. */
export class PrismaPersonalConfigurationProposalRepository implements PersonalConfigurationProposalRepository
{
	/** Transaction-scoped client supplied by the proposal unit of work. */
	private readonly transaction: PrismaTypes.TransactionClient;

	/** Creates the proposal repository over one transaction snapshot. */
	constructor(transaction: PrismaTypes.TransactionClient)
	{
		this.transaction = transaction;
	}

	/** Verify every mutable source coordinate before inserting immutable proposal evidence. */
	async propose(command: ProposePersonalConfigurationChangeCommand): Promise<PersonalConfigurationProposalPersistenceResult>
	{
		// 1. Bind the persona profile to the authenticated owner and capture its current revision.
		const profile = await this.transaction.personaProfile.findFirst({ where: { id: command.personaProfileId, siloId: command.siloId, userId: command.userId }, select: { activeRevisionId: true } });
		if (profile === null) return { status: PersonalConfigurationProposalCodes.ProvenanceConflict };

		// 2. Rebind the conversation, run, and personal service to the same owner and silo.
		const thread = await this.transaction.conversationThread.findFirst({ where: { id: command.sourceThreadId, siloId: command.siloId, participants: { some: { userId: command.userId } } }, select: { agentServiceId: true } });
		const run = await this.transaction.agentRun.findFirst({ where: { id: command.sourceRunId, siloId: command.siloId, threadId: command.sourceThreadId, agentServiceId: command.agentServiceId, delegatedUserId: command.userId }, select: { id: true } });
		const service = await this.transaction.agentService.findFirst({ where: { id: command.agentServiceId, siloId: command.siloId, kind: AgentServiceKind.Personal }, select: { activeRevisionId: true } });
		if (thread === null || thread.agentServiceId !== command.agentServiceId || run === null || service === null || profile.activeRevisionId !== command.expectedPersonaRevisionId || service.activeRevisionId !== command.expectedAgentRevisionId)
		{
			return { status: PersonalConfigurationProposalCodes.ProvenanceConflict };
		}

		// 3. Store only immutable request evidence for a later owner decision and materialisation.
		const change = await this.transaction.personalConfigurationChange.create({ data: { siloId: command.siloId, userId: command.userId, personaProfileId: command.personaProfileId, agentServiceId: command.agentServiceId, sourceThreadId: command.sourceThreadId, sourceRunId: command.sourceRunId, sourceMessageId: command.sourceMessageId, requestedPatch: command.requestedPatch as Prisma.InputJsonValue, requestedPatchDigest: command.requestedPatchDigest, expectedPersonaRevisionId: command.expectedPersonaRevisionId, expectedAgentRevisionId: command.expectedAgentRevisionId, proposedAt: new Date(command.proposedAt) }, select: { id: true } });
		return { status: PersonalConfigurationProposalCodes.Proposed, changeId: change.id };
	}
}
