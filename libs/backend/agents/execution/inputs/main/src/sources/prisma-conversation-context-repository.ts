import { AgentRunState, ConversationLifecycle, ConversationMode, OrgMemberStatus, Prisma } from "@prisma/client";

import { RunAdmissionDenialReasons, RunAdmissionMessageInputModes, type InitialRunAuthority } from "@opencrane/backend/agents/execution/runs";
import type { ExecutionSubject } from "@opencrane/models/agents";

import type { ConversationContextInput, ConversationContextRepository, ConversationHistoryAdmissionReader, SessionAssemblyCommand, SessionAssemblyLoad } from "../assembly/session-assembly.types";

/**
 * Turns one conversation into an ordered list of message ids, for the snapshot.
 *
 * Everything it requires of the conversation is a condition, not a filter: open, in the caller's
 * silo, on this run's own AgentService, an agent session, and with the caller still a participant.
 * It also re-checks org membership in this transaction before returning anything, so a user removed
 * from the org between request and admission gets nothing back.
 *
 * Only completed messages go in, so the snapshot can never name a message whose content later
 * changes. If another unfinished run already owns the conversation it refuses with `active_run`.
 *
 * @implements ConversationContextRepository
 */
export class PrismaConversationContextRepository implements ConversationContextRepository
{
	/** The admission transaction every input source shares. */
	private readonly transaction: Prisma.TransactionClient;
	/** Durable history reader supplied by the conversation composition owner. */
	private readonly history: ConversationHistoryAdmissionReader;

	/** Creates the reader over one admission transaction. */
	constructor(transaction: Prisma.TransactionClient, history: ConversationHistoryAdmissionReader)
	{
		this.transaction = transaction;
		this.history = history;
	}

	/** Returns no messages for non-conversational work; otherwise only completed messages the caller may see. */
	async load(command: SessionAssemblyCommand, run: InitialRunAuthority, executionSubject: ExecutionSubject): Promise<SessionAssemblyLoad<ConversationContextInput>>
	{
		// 1. Avoid an unnecessary conversation lookup when the admitted run has no conversation.
		if (command.conversationId === null)
		{
			return command.messageInput === null ? { outcome: "loaded", value: { messageIds: [] } } : { outcome: "denied", reason: "conversation_unavailable" };
		}
		if (command.messageInput === null || command.messageInput.mode !== RunAdmissionMessageInputModes.PrePersistedHistory)
			return { outcome: "denied", reason: "conversation_unavailable" };

		// 2. Re-check the verified principal's organization membership before returning any conversation state.
		const membership = await this.transaction.orgMembership.findFirst({ where: { clusterTenant: command.siloId, subject: command.requester.subjectId, status: OrgMemberStatus.Active }, select: { clusterTenant: true } });
		if (membership === null)
		{
			return { outcome: "denied", reason: "conversation_unavailable" };
		}

		// 3. Bind the conversation to its silo, service, mode, open lifecycle, and participant.
		const conversation = await this.transaction.conversation.findFirst({
			where: { id: command.conversationId, siloId: command.siloId, agentServiceId: run.agentServiceId, mode: ConversationMode.AgentSession, lifecycle: ConversationLifecycle.Open, participants: { some: { userId: command.requester.subjectId, accessEndedPosition: null } } },
			select: { id: true, runs: { where: { state: { notIn: [AgentRunState.Completed, AgentRunState.Failed] } }, take: 1, select: { id: true } } },
		});
		if (conversation === null)
		{
			return { outcome: "denied", reason: "conversation_unavailable" };
		}
		if (conversation.runs.length > 0)
		{
			return { outcome: "denied", reason: RunAdmissionDenialReasons.ActiveRun };
		}

		// 4. Re-read the exact Kurrent revision so the snapshot cannot trust history coordinates copied by a caller.
		const history = await this.history.read({ siloId: command.siloId, conversationId: conversation.id, expectedRevision: command.messageInput.historyRevision });
		if (history === null || !_MatchesHistory(command, executionSubject, history))
			return { outcome: "denied", reason: "conversation_unavailable" };
		return { outcome: "loaded", value: { messageIds: [...history.orderedMessageIds] } };
	}
}

/** Checks the history revision, order and human requester even when a company Principal executes the run. */
function _MatchesHistory(command: SessionAssemblyCommand, executionSubject: ExecutionSubject, history: Awaited<ReturnType<ConversationHistoryAdmissionReader["read"]>>): history is Exclude<typeof history, null>
{
	if (history === null || command.messageInput === null)
		return false;
	const expected = command.messageInput;
	return history.historyRevision === expected.historyRevision
		&& history.orderedMessageIds.length === expected.orderedMessageIds.length
		&& history.orderedMessageIds.every(function _SameMessage(messageId, index): boolean { return expected.orderedMessageIds[index] === messageId; })
		&& history.orderedMessageIds.at(-1) === expected.messageId
		&& history.finalMessageAuthor.principalId === executionSubject.requester.requesterPrincipalId
		&& history.finalMessageAuthor.principalId === expected.author.principalId
		&& history.finalMessageAuthor.issuer === expected.author.issuer
		&& history.finalMessageAuthor.subjectId === expected.author.subjectId
		&& history.finalMessageAuthor.authenticatedAt === expected.author.authenticatedAt
		&& expected.author.issuer === command.requester.issuer
		&& expected.author.subjectId === command.requester.subjectId
		&& expected.author.authenticatedAt === command.requester.authenticatedAt;
}
