import { AgentRunState, AgentServiceKind, AgentServiceState, ConversationLifecycle, ConversationMessageRole, ConversationMessageState, ConversationMode, OrgMemberStatus, Prisma } from "@prisma/client";

import { __DecideConversationCommand, ConversationCommandActions, ConversationCommandKinds, ConversationLifecycles } from "@opencrane/models/conversations";

import type { ConversationCaller, ConversationWriteDenial, CreateConversationRequest, SubmitConversationMessageRequest } from "./conversation-authority.types.js";
import type { ConversationMutationRepository, ConversationMutationStatus } from "./prisma-conversation-mutation-repository.types.js";
import { PrismaConversationQueryRepository } from "./prisma-conversation-query-repository.js";

/** Transaction-scoped writer for immutable-mode conversations and participant messages. */
export class PrismaConversationMutationRepository implements ConversationMutationRepository
{
	private readonly transaction: Prisma.TransactionClient;
	private readonly query: PrismaConversationQueryRepository;

	/** Creates the writer and its query collaborator over the same transaction snapshot. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
		this.query = new PrismaConversationQueryRepository(this.transaction);
	}

	/** Creates one immutable-mode aggregate after checking every initial participant and service. */
	async create(caller: ConversationCaller, conversationId: string, request: CreateConversationRequest): Promise<{ readonly outcome: "created" } | { readonly outcome: "denied"; readonly reason: ConversationWriteDenial }>
	{
		const participantUserIds = _participantIds(caller.subjectId, request);
		if (participantUserIds === null) return { outcome: "denied", reason: "participant_unavailable" };
		const membershipCount = await this.transaction.orgMembership.count({ where: { clusterTenant: caller.siloId, subject: { in: [...participantUserIds] }, status: OrgMemberStatus.Active } });
		if (membershipCount !== participantUserIds.length) return { outcome: "denied", reason: "participant_unavailable" };
		if (request.mode === "agent_session")
		{
			const service = await this.transaction.agentService.findFirst({ where: { id: request.agentServiceId, siloId: caller.siloId, kind: AgentServiceKind.Personal, state: AgentServiceState.Active, activeRevisionId: { not: null } }, select: { id: true } });
			if (service === null) return { outcome: "denied", reason: "agent_service_unavailable" };
		}
		await this.transaction.conversation.create({ data: { id: conversationId, siloId: caller.siloId, mode: _prismaMode(request.mode), agentServiceId: request.mode === "agent_session" ? request.agentServiceId : null } });
		for (const userId of participantUserIds) await this.transaction.conversationParticipant.create({ data: { conversationId, userId } });
		return { outcome: "created" };
	}

	/** Changes only the caller's participant-local archived state. */
	async setArchived(caller: ConversationCaller, conversationId: string, archived: boolean): Promise<ConversationMutationStatus>
	{
		const changed = await this.transaction.conversationParticipant.updateMany({ where: { conversationId, userId: caller.subjectId, conversation: { siloId: caller.siloId } }, data: { archivedAt: archived ? new Date() : null } });
		return changed.count === 1 ? "changed" : "unavailable";
	}

	/** Closes only after the same transaction proves participant and foreground-run state. */
	async close(caller: ConversationCaller, conversationId: string): Promise<ConversationMutationStatus>
	{
		const participant = await this.transaction.conversationParticipant.findFirst({ where: { conversationId, userId: caller.subjectId, accessEndedPosition: null, conversation: { siloId: caller.siloId } }, select: { conversationId: true } });
		if (participant === null) return "unavailable";
		const activeRun = await this.transaction.agentRun.findFirst({ where: { conversationId, state: { notIn: [AgentRunState.Completed, AgentRunState.Failed, AgentRunState.Cancelled] } }, select: { id: true } });
		if (activeRun !== null) return "active_run";
		const update = await this.transaction.conversation.updateMany({ where: { id: conversationId, siloId: caller.siloId, lifecycle: ConversationLifecycle.Open }, data: { lifecycle: ConversationLifecycle.Closed, closedAt: new Date() } });
		return update.count === 1 ? "changed" : "unavailable";
	}

	/** Revalidates the mode strategy and persists one ordinary direct/group message. */
	async admitOrdinaryMessage(caller: ConversationCaller, conversationId: string, messageId: string, request: SubmitConversationMessageRequest): Promise<{ readonly outcome: "accepted" } | { readonly outcome: "denied"; readonly reason: ConversationWriteDenial }>
	{
		const context = await this.query.loadCommandContext(caller, conversationId);
		if (context === null) return { outcome: "denied", reason: "conversation_unavailable" };
		const decision = __DecideConversationCommand({ ...context, command: { kind: ConversationCommandKinds.SubmitMessage } });
		if (!decision.allowed || decision.action !== ConversationCommandActions.AdmitOrdinaryMessage) return { outcome: "denied", reason: context.lifecycle === ConversationLifecycles.Closed ? "conversation_closed" : "command_not_supported" };
		await this.transaction.conversationMessage.create({ data: _messageData(messageId, conversationId, caller.subjectId, request, null) });
		return { outcome: "accepted" };
	}

	/** Persists a user message inside run admission's sole final transaction. */
	async persistAgentMessage(caller: ConversationCaller, conversationId: string, messageId: string, runId: string, request: SubmitConversationMessageRequest): Promise<void>
	{
		await this.transaction.conversationMessage.create({ data: _messageData(messageId, conversationId, caller.subjectId, request, runId) });
	}
}

/** Returns the exact initial participant set or null for an invalid mode cardinality. */
function _participantIds(subjectId: string, request: CreateConversationRequest): readonly string[] | null
{
	if (request.mode === "agent_session") return [subjectId];
	const ids = [...new Set([subjectId, ...request.participantUserIds.map(function _Trim(value): string { return value.trim(); })])].filter(Boolean).sort();
	if (request.mode === "direct") return ids.length === 2 ? ids : null;
	return ids.length >= 2 && ids.length <= 100 ? ids : null;
}

/** Constructs the one legal completed participant-input message row. */
function _messageData(messageId: string, conversationId: string, userId: string, request: SubmitConversationMessageRequest, runId: string | null): Prisma.ConversationMessageUncheckedCreateInput
{
	return { id: messageId, conversationId, runId, userId, idempotencyKey: request.idempotencyKey, role: ConversationMessageRole.User, state: ConversationMessageState.Completed, source: "user_input", blocks: request.blocks as unknown as Prisma.InputJsonValue, completedAt: new Date() };
}

/** Maps dependency-light mode vocabulary to Prisma's generated enum. */
function _prismaMode(mode: CreateConversationRequest["mode"]): ConversationMode
{
	if (mode === "agent_session") return ConversationMode.AgentSession;
	if (mode === "direct") return ConversationMode.Direct;
	return ConversationMode.Group;
}
