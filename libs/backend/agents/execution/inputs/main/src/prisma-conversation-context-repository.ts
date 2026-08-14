import { AgentRunState, ConversationLifecycle, ConversationMessageState, ConversationMode, OrgMemberStatus, Prisma } from "@prisma/client";

import { RunAdmissionDenialReasons, type InitialRunAuthority } from "@opencrane/backend/agents/execution/runs";

import type { ConversationContextInput, ConversationContextRepository, SessionAssemblyCommand, SessionAssemblyLoad } from "./session-assembly.types";

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

	/** Creates the reader over one admission transaction. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/** Returns no messages for non-conversational work; otherwise only completed messages the caller may see. */
	async load(command: SessionAssemblyCommand, run: InitialRunAuthority): Promise<SessionAssemblyLoad<ConversationContextInput>>
	{
		// 1. Avoid an unnecessary conversation lookup for scheduled and other non-conversational work.
		if (command.conversationId === null) return { outcome: "loaded", value: { messageIds: [], pendingUserMessage: null } };
		if (command.identityKind !== "user") return { outcome: "denied", reason: "conversation_unavailable" };

		// 2. Re-check the caller's organization membership in this transaction before returning any conversation or run state.
		const membership = await this.transaction.orgMembership.findFirst({ where: { clusterTenant: command.siloId, subject: command.executionSubjectId, status: OrgMemberStatus.Active }, select: { clusterTenant: true } });
		if (membership === null) return { outcome: "denied", reason: "conversation_unavailable" };

		// 3. Bind the conversation to its silo, service, mode, open lifecycle, and participant.
		const conversation = await this.transaction.conversation.findFirst({
			where: { id: command.conversationId, siloId: command.siloId, agentServiceId: run.agentServiceId, mode: ConversationMode.AgentSession, lifecycle: ConversationLifecycle.Open, participants: { some: { userId: command.executionSubjectId, accessEndedPosition: null } } },
			select: { id: true, runs: { where: { state: { notIn: [AgentRunState.Completed, AgentRunState.Failed, AgentRunState.Cancelled] } }, take: 1, select: { id: true } } },
		});
		if (conversation === null) return { outcome: "denied", reason: "conversation_unavailable" };
		if (conversation.runs.length > 0) return { outcome: "denied", reason: RunAdmissionDenialReasons.ActiveRun };

		// 4. Take only completed messages, in transcript order. A message still being written stays out of the snapshot.
		const entries = await this.transaction.conversationTimelineEntry.findMany({
			where: { conversationId: conversation.id, message: { is: { state: ConversationMessageState.Completed } } },
			orderBy: { position: "asc" },
			select: { messageId: true },
		});
		return {
			outcome: "loaded",
			value: {
				messageIds: [...entries.flatMap(function _MessageId(entry): readonly string[] { return entry.messageId === null ? [] : [entry.messageId]; }), command.inputMessageId!],
				pendingUserMessage: { id: command.inputMessageId!, blocks: command.inputMessageBlocks! },
			},
		};
	}
}
