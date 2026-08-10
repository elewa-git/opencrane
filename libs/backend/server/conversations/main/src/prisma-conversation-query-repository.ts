import { AgentRunState, ConversationLifecycle, ConversationMessageRole, ConversationMessageState, ConversationMode, Prisma } from "@prisma/client";

import { ConversationLifecycles, ConversationModes, type MessageContentBlock } from "@opencrane/models/conversations";

import type { ConversationCaller, ConversationDetail, ConversationMessageView, ConversationSummary } from "./conversation-authority.types.js";
import type { ConversationCommandContext, ConversationQueryRepository } from "./prisma-conversation-query-repository.types.js";

/** Maximum message rows returned by one participant-bound open operation. */
const _MESSAGE_LIMIT = 100;

/** Participant-scoped Conversation reads shared by root and transaction-bound command paths. */
export class PrismaConversationQueryRepository implements ConversationQueryRepository
{
	private readonly prisma: Prisma.TransactionClient;

	/** Binds reads to either the root client or the current authority transaction. */
	constructor(prisma: Prisma.TransactionClient)
	{
		this.prisma = prisma;
	}

	/** Lists current participant conversations without treating participant-local archive as lifecycle. */
	async list(caller: ConversationCaller, includeArchived: boolean): Promise<readonly ConversationSummary[]>
	{
		const participants = await this.prisma.conversationParticipant.findMany({
			where: { userId: caller.subjectId, conversation: { siloId: caller.siloId }, ...(includeArchived ? {} : { archivedAt: null }) },
			include: { conversation: { include: { participants: { select: { userId: true } } } } },
			orderBy: [{ conversation: { updatedAt: "desc" } }, { conversationId: "desc" }],
		});
		return participants.map(function _Summary(participant): ConversationSummary { return _summary(participant.conversation, participant); });
	}

	/** Returns the exact participant-visible aggregate and latest canonical message window. */
	async open(caller: ConversationCaller, conversationId: string): Promise<ConversationDetail | null>
	{
		const participant = await this.prisma.conversationParticipant.findFirst({ where: { conversationId, userId: caller.subjectId, conversation: { siloId: caller.siloId } }, include: { conversation: { include: { participants: { select: { userId: true } } } } } });
		if (participant === null) return null;
		const entries = await this.prisma.conversationTimelineEntry.findMany({ where: { conversationId, position: { gte: participant.visibleFromPosition, ...(participant.accessEndedPosition === null ? {} : { lte: participant.accessEndedPosition }) }, messageId: { not: null } }, include: { message: true }, orderBy: { position: "desc" }, take: _MESSAGE_LIMIT });
		return {
			..._summary(participant.conversation, participant),
			visibleFromPosition: participant.visibleFromPosition.toString(10),
			accessEndedPosition: participant.accessEndedPosition?.toString(10) ?? null,
			messages: [...entries].reverse().flatMap(function _Message(entry): readonly ConversationMessageView[] { return entry.message === null ? [] : [_messageView(entry.message, entry.position)]; }),
		};
	}

	/** Loads exact durable mode, lifecycle, binding, and foreground-run strategy facts. */
	async loadCommandContext(caller: ConversationCaller, conversationId: string): Promise<ConversationCommandContext | null>
	{
		const conversation = await this.prisma.conversation.findFirst({ where: { id: conversationId, siloId: caller.siloId, participants: { some: { userId: caller.subjectId, accessEndedPosition: null } } }, select: { mode: true, lifecycle: true, agentServiceId: true, runs: { where: { state: { notIn: [AgentRunState.Completed, AgentRunState.Failed, AgentRunState.Cancelled] } }, select: { id: true }, take: 2 } } });
		if (conversation === null || conversation.runs.length > 1) return null;
		return { mode: _mode(conversation.mode), lifecycle: conversation.lifecycle === ConversationLifecycle.Open ? ConversationLifecycles.Open : ConversationLifecycles.Closed, agentServiceId: conversation.agentServiceId, activeRunId: conversation.runs[0]?.id ?? null };
	}

	/** Resolves one caller-owned idempotency-scoped canonical message. */
	async findOwnMessage(caller: ConversationCaller, conversationId: string, idempotencyKey: string): Promise<ConversationMessageView | null>
	{
		const entry = await this.prisma.conversationTimelineEntry.findFirst({ where: { conversationId, message: { is: { idempotencyKey, userId: caller.subjectId, conversation: { siloId: caller.siloId, participants: { some: { userId: caller.subjectId } } } } } }, include: { message: true } });
		return entry?.message ? _messageView(entry.message, entry.position) : null;
	}

	/** Detects a conversation-scoped key owned by another participant without returning their message. */
	async hasMessageIdempotencyKey(caller: ConversationCaller, conversationId: string, idempotencyKey: string): Promise<boolean>
	{
		const message = await this.prisma.conversationMessage.findFirst({ where: { conversationId, idempotencyKey, conversation: { siloId: caller.siloId, participants: { some: { userId: caller.subjectId, accessEndedPosition: null } } } }, select: { id: true } });
		return message !== null;
	}
}

/** Maps one Prisma aggregate to the transport-safe participant summary. */
function _summary(conversation: { id: string; mode: ConversationMode; lifecycle: ConversationLifecycle; agentServiceId: string | null; updatedAt: Date; participants: readonly { userId: string }[] }, participant: { archivedAt: Date | null; readThroughPosition: bigint }): ConversationSummary
{
	return { id: conversation.id, mode: _mode(conversation.mode), lifecycle: conversation.lifecycle === ConversationLifecycle.Open ? "open" : "closed", agentServiceId: conversation.agentServiceId, participantUserIds: conversation.participants.map(function _UserId(row): string { return row.userId; }).sort(), archivedAt: participant.archivedAt?.toISOString() ?? null, readThroughPosition: participant.readThroughPosition.toString(10), updatedAt: conversation.updatedAt.toISOString() };
}

/** Maps a canonical persisted message and database-owned position. */
function _messageView(message: { id: string; role: ConversationMessageRole; state: ConversationMessageState; source: string; blocks: Prisma.JsonValue; runId: string | null; userId: string | null; createdAt: Date; completedAt: Date | null }, position: bigint): ConversationMessageView
{
	return { id: message.id, position: position.toString(10), role: message.role.toLowerCase() as ConversationMessageView["role"], state: message.state.toLowerCase() as ConversationMessageView["state"], source: message.source as ConversationMessageView["source"], blocks: message.blocks as unknown as readonly MessageContentBlock[], runId: message.runId, userId: message.userId, createdAt: message.createdAt.toISOString(), completedAt: message.completedAt?.toISOString() ?? null };
}

/** Maps persisted enum vocabulary to the dependency-light model enum. */
function _mode(mode: ConversationMode): ConversationModes
{
	if (mode === ConversationMode.AgentSession) return ConversationModes.AgentSession;
	if (mode === ConversationMode.Direct) return ConversationModes.Direct;
	return ConversationModes.Group;
}
