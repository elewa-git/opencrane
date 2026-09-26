import { AgentRunState, ConversationLifecycle, ConversationMode, OrgMemberStatus, Prisma } from "@prisma/client";

import { RunAdmissionDenialReasons, RunAdmissionMessageInputModes, type InitialRunAuthority } from "@opencrane/backend/agents/execution/runs";
import { AgentRunTriggers } from "@opencrane/contracts";
import type { ExecutionSubject } from "@opencrane/models/agents";

import { SessionAssemblyLoadOutcomes, type ConversationContextInput, type ConversationContextRepository, type ConversationHistoryAdmissionReader, type SessionAssemblyCommand, type SessionAssemblyLoad } from "../assembly/session-assembly.types";
import type { RoutineOccurrencePromptAdmissionReader } from "./routine-occurrence-prompt.types";

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
	/** Service-attested prompt reader supplied only by routine-capable composition. */
	private readonly routinePrompt: RoutineOccurrencePromptAdmissionReader | undefined;

	/** Creates the reader over one admission transaction. */
	constructor(transaction: Prisma.TransactionClient, history: ConversationHistoryAdmissionReader, routinePrompt?: RoutineOccurrencePromptAdmissionReader)
	{
		this.transaction = transaction;
		this.history = history;
		this.routinePrompt = routinePrompt;
	}

	/** Returns no messages for non-conversational work; otherwise only completed messages the caller may see. */
	async load(command: SessionAssemblyCommand, run: InitialRunAuthority, executionSubject: ExecutionSubject): Promise<SessionAssemblyLoad<ConversationContextInput>>
	{
		if (command.trigger !== AgentRunTriggers.Interactive)
			return this._LoadRoutinePrompt(command, run);

		// 1. Avoid an unnecessary conversation lookup when the admitted run has no conversation.
		if (command.conversationId === null)
		{
			return command.messageInput === null ? { outcome: SessionAssemblyLoadOutcomes.Loaded, value: { messageIds: [] } } : { outcome: SessionAssemblyLoadOutcomes.Denied, reason: "conversation_unavailable" };
		}
		if (command.messageInput === null || command.messageInput.mode !== RunAdmissionMessageInputModes.PrePersistedHistory)
			return { outcome: SessionAssemblyLoadOutcomes.Denied, reason: "conversation_unavailable" };

		// 2. Re-check the verified principal's organization membership before returning any conversation state.
		const membership = await this.transaction.orgMembership.findFirst({ where: { clusterTenant: command.siloId, subject: command.requester.subjectId, status: OrgMemberStatus.Active }, select: { clusterTenant: true } });
		if (membership === null)
		{
			return { outcome: SessionAssemblyLoadOutcomes.Denied, reason: "conversation_unavailable" };
		}

		// 3. Bind the conversation to its silo, service, mode, open lifecycle, and participant.
		const conversation = await this.transaction.conversation.findFirst({
			where: { id: command.conversationId, siloId: command.siloId, agentServiceId: run.agentServiceId, mode: ConversationMode.AgentSession, lifecycle: ConversationLifecycle.Open, participants: { some: { userId: command.requester.subjectId, accessEndedPosition: null } } },
			select: { id: true, runs: { where: { state: { notIn: [AgentRunState.Completed, AgentRunState.Failed] } }, take: 1, select: { id: true } } },
		});
		if (conversation === null)
		{
			return { outcome: SessionAssemblyLoadOutcomes.Denied, reason: "conversation_unavailable" };
		}
		if (conversation.runs.length > 0)
		{
			return { outcome: SessionAssemblyLoadOutcomes.Denied, reason: RunAdmissionDenialReasons.ActiveRun };
		}

		// 4. Re-read the exact Kurrent revision so the snapshot cannot trust history coordinates copied by a caller.
		const history = await this.history.read({ siloId: command.siloId, conversationId: conversation.id, expectedRevision: command.messageInput.historyRevision });
		if (history === null || !_MatchesHistory(command, executionSubject, history))
			return { outcome: SessionAssemblyLoadOutcomes.Denied, reason: "conversation_unavailable" };
		return { outcome: SessionAssemblyLoadOutcomes.Loaded, value: { messageIds: [...history.orderedMessageIds] } };
	}

	/** Load an occurrence's service-authored prompt without manufacturing a human requester message. */
	private async _LoadRoutinePrompt(command: Exclude<SessionAssemblyCommand, { readonly trigger: `${AgentRunTriggers.Interactive}` }>, run: InitialRunAuthority): Promise<SessionAssemblyLoad<ConversationContextInput>>
	{
		if (command.conversationId === null || this.routinePrompt === undefined)
			return { outcome: SessionAssemblyLoadOutcomes.Denied, reason: "conversation_unavailable" };
		const conversation = await this.transaction.conversation.findFirst({
			where: { id: command.conversationId, siloId: command.siloId, agentServiceId: run.agentServiceId, mode: ConversationMode.AgentSession, lifecycle: ConversationLifecycle.Open },
			select: { id: true, activeComputerLease: { select: { leaseId: true } }, runs: { where: { state: { notIn: [AgentRunState.Completed, AgentRunState.Failed] } }, take: 1, select: { id: true } } },
		});
		if (conversation === null || conversation.activeComputerLease === null || conversation.runs.length > 0)
			return { outcome: SessionAssemblyLoadOutcomes.Denied, reason: conversation?.runs.length ? RunAdmissionDenialReasons.ActiveRun : "conversation_unavailable" };
		const prompt = await this.routinePrompt.read({ siloId: command.siloId, conversationId: conversation.id, agentServiceId: run.agentServiceId, trigger: command.trigger, routine: command.routineInput });
		if (prompt === null || prompt.historyRevision.trim().length === 0 || prompt.orderedMessageIds.length === 0
			|| new Set(prompt.orderedMessageIds).size !== prompt.orderedMessageIds.length
			|| !prompt.orderedMessageIds.every(function _NonBlank(messageId): boolean { return messageId.trim().length > 0; }))
			return { outcome: SessionAssemblyLoadOutcomes.Denied, reason: "conversation_unavailable" };
		return { outcome: SessionAssemblyLoadOutcomes.Loaded, value: { messageIds: [...prompt.orderedMessageIds] } };
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
