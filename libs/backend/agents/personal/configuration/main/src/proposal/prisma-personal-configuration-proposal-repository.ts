import { AgentServiceKind, ConversationMode, Prisma } from "@prisma/client";

import { PersonalConfigurationProposalCodes, type ProposePersonalConfigurationChangeCommand } from "./personal-configuration-proposal.types.js";
import type { PersonalConfigurationProposalPersistenceResult, PersonalConfigurationProposalRepository } from "./personal-configuration-proposal-repository.types.js";

/** Prisma repository that proves proposal provenance inside its owning transaction. */
export class PrismaPersonalConfigurationProposalRepository implements PersonalConfigurationProposalRepository
{
	/** Transaction-scoped client supplied by the proposal unit of work. */
	private readonly transaction: Prisma.TransactionClient;

	/** Creates the proposal repository over one transaction snapshot. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/** Verify every mutable source coordinate before inserting immutable proposal evidence. */
	async propose(command: ProposePersonalConfigurationChangeCommand): Promise<PersonalConfigurationProposalPersistenceResult>
	{
		// 1. Bind the persona profile to the authenticated owner and capture its current revision.
		const profile = await this.transaction.personaProfile.findFirst(_profileLookup(command));
		if (profile === null || profile.activeRevisionId !== command.expectedPersonaRevisionId) return _provenanceConflict();

		// 2. Require an active participant in the exact personal-agent conversation.
		const conversation = await this.transaction.conversation.findFirst(_conversationLookup(command));
		if (conversation === null || conversation.agentServiceId !== command.agentServiceId) return _provenanceConflict();

		// 3. Rebind the recorded run to that owner, conversation, service, and silo.
		const run = await this.transaction.agentRun.findFirst(_runLookup(command));
		if (run === null) return _provenanceConflict();

		// 4. Require the exact personal service revision observed by the proposing run.
		const service = await this.transaction.agentService.findFirst(_personalServiceLookup(command));
		if (service === null || service.activeRevisionId !== command.expectedAgentRevisionId) return _provenanceConflict();

		// 5. Store immutable request evidence only after every mutable coordinate agrees.
		const change = await this.transaction.personalConfigurationChange.create(_proposalCreate(command));
		return _proposed(change.id);
	}
}

/** Initializes the owner-bound persona profile lookup and its active-revision evidence. */
function _profileLookup(command: ProposePersonalConfigurationChangeCommand): Prisma.PersonaProfileFindFirstArgs
{
	const query: Prisma.PersonaProfileFindFirstArgs = {
		where: { id: command.personaProfileId, siloId: command.siloId, userId: command.userId },
		select: { activeRevisionId: true },
	};
	return query;
}

/** Initializes the active participant lookup for the exact personal-agent conversation. */
function _conversationLookup(command: ProposePersonalConfigurationChangeCommand): Prisma.ConversationFindFirstArgs
{
	const query: Prisma.ConversationFindFirstArgs = {
		where: {
			id: command.sourceConversationId,
			siloId: command.siloId,
			mode: ConversationMode.AgentSession,
			participants: { some: { userId: command.userId, accessEndedPosition: null } },
		},
		select: { agentServiceId: true },
	};
	return query;
}

/** Initializes the exact run provenance lookup for the proposing user and service. */
function _runLookup(command: ProposePersonalConfigurationChangeCommand): Prisma.AgentRunFindFirstArgs
{
	const query: Prisma.AgentRunFindFirstArgs = {
		where: {
			id: command.sourceRunId,
			siloId: command.siloId,
			conversationId: command.sourceConversationId,
			agentServiceId: command.agentServiceId,
			delegatedUserId: command.userId,
		},
		select: { id: true },
	};
	return query;
}

/** Initializes the personal-service lookup and its active-revision evidence. */
function _personalServiceLookup(command: ProposePersonalConfigurationChangeCommand): Prisma.AgentServiceFindFirstArgs
{
	const query: Prisma.AgentServiceFindFirstArgs = {
		where: { id: command.agentServiceId, siloId: command.siloId, kind: AgentServiceKind.Personal },
		select: { activeRevisionId: true },
	};
	return query;
}

/** Initializes the immutable proposal journal insert after provenance is proven. */
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

/** Returns the stable fail-closed result for any mismatched provenance coordinate. */
function _provenanceConflict(): PersonalConfigurationProposalPersistenceResult
{
	const result: PersonalConfigurationProposalPersistenceResult = { status: PersonalConfigurationProposalCodes.ProvenanceConflict };
	return result;
}

/** Returns the stable successful result for one immutable proposal journal row. */
function _proposed(changeId: string): PersonalConfigurationProposalPersistenceResult
{
	const result: PersonalConfigurationProposalPersistenceResult = { status: PersonalConfigurationProposalCodes.Proposed, changeId };
	return result;
}
