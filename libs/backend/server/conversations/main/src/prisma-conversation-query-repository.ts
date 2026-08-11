import { AgentRunState, ConversationLifecycle, ConversationMessageRole, ConversationMessageState, ConversationMode, OrgMemberStatus, Prisma } from "@prisma/client";

import { ConversationLifecycles, ConversationModes, MessageRoles, MessageSources, MessageStates, type MessageContentBlock } from "@opencrane/models/conversations";

import type { ConversationCaller, ConversationDetail, ConversationMessageView, ConversationSummary } from "./conversation-authority.types.js";
import type { ConversationCommandContext, ConversationQueryRepository } from "./prisma-conversation-query-repository.types.js";

/** Maximum message rows returned by one participant-bound open operation. */
const _MESSAGE_LIMIT = 100;

/** Exhaustive adapter mapping from persisted modes to the dependency-light model vocabulary. */
const _MODE_BY_PERSISTED_MODE: Readonly<Record<ConversationMode, ConversationModes>> = {
	[ConversationMode.AgentSession]: ConversationModes.AgentSession,
	[ConversationMode.Direct]: ConversationModes.Direct,
	[ConversationMode.Group]: ConversationModes.Group,
};

/** Exhaustive adapter mapping from persisted lifecycle to the dependency-light model vocabulary. */
const _LIFECYCLE_BY_PERSISTED_LIFECYCLE: Readonly<Record<ConversationLifecycle, ConversationLifecycles>> = {
	[ConversationLifecycle.Open]: ConversationLifecycles.Open,
	[ConversationLifecycle.Closed]: ConversationLifecycles.Closed,
};

/** Exhaustive adapter mapping from persisted message roles to model-owned wire vocabulary. */
const _ROLE_BY_PERSISTED_ROLE: Readonly<Record<ConversationMessageRole, MessageRoles>> = {
	[ConversationMessageRole.User]: MessageRoles.User,
	[ConversationMessageRole.Assistant]: MessageRoles.Assistant,
	[ConversationMessageRole.Tool]: MessageRoles.Tool,
	[ConversationMessageRole.System]: MessageRoles.System,
};

/** Exhaustive adapter mapping from persisted message states to model-owned wire vocabulary. */
const _STATE_BY_PERSISTED_STATE: Readonly<Record<ConversationMessageState, MessageStates>> = {
	[ConversationMessageState.Pending]: MessageStates.Pending,
	[ConversationMessageState.Streaming]: MessageStates.Streaming,
	[ConversationMessageState.Completed]: MessageStates.Completed,
	[ConversationMessageState.Failed]: MessageStates.Failed,
	[ConversationMessageState.Cancelled]: MessageStates.Cancelled,
};

/** Participant-scoped Conversation reads shared by root and transaction-bound command paths. */
export class PrismaConversationQueryRepository implements ConversationQueryRepository
{
	private readonly prisma: Prisma.TransactionClient;

	/** Binds reads to either the root client or the current authority transaction. */
	constructor(prisma: Prisma.TransactionClient)
	{
		this.prisma = prisma;
	}

	/** Proves current active organisation membership inside the repository's exact transaction snapshot. */
	async hasActiveCallerMembership(caller: ConversationCaller): Promise<boolean>
	{
		const membership = await this.prisma.orgMembership.findFirst({ where: { clusterTenant: caller.siloId, subject: caller.subjectId, status: OrgMemberStatus.Active }, select: { clusterTenant: true } });
		return membership !== null;
	}

	/** Lists current participant conversations without treating participant-local archive as lifecycle. */
	async list(caller: ConversationCaller, includeArchived: boolean): Promise<readonly ConversationSummary[]>
	{
		// 1. Membership revocation closes the whole silo authority before participant rows are consulted.
		if (!await this.hasActiveCallerMembership(caller)) return [];

		// 2. Read only participant coordinates from the same repeatable snapshot as membership.
		// The global sequence records allocation order; rollback gaps are valid and commit order never rewrites it.
		const participants = await this.prisma.conversationParticipant.findMany({
			where: { userId: caller.subjectId, conversation: { siloId: caller.siloId }, ...(includeArchived ? {} : { archivedAt: null }) },
			include: { conversation: { include: { participants: { select: { userId: true } } } } },
			orderBy: [{ conversation: { activitySequence: "desc" } }, { conversationId: "desc" }],
		});

		// 3. Project bounded summaries only after both authority fences have succeeded.
		return participants.map(function _Summary(participant): ConversationSummary { return _summary(participant.conversation, participant); });
	}

	/** Returns the exact participant-visible aggregate and latest canonical message window. */
	async open(caller: ConversationCaller, conversationId: string): Promise<ConversationDetail | null>
	{
		// 1. Membership revocation denies the aggregate before its existence can be disclosed.
		if (!await this.hasActiveCallerMembership(caller)) return null;

		// 2. Resolve the exact participant visibility coordinates inside this membership snapshot.
		const participant = await this.prisma.conversationParticipant.findFirst({ where: { conversationId, userId: caller.subjectId, conversation: { siloId: caller.siloId } }, include: { conversation: { include: { participants: { select: { userId: true } } } } } });
		if (participant === null) return null;

		// 3. Clip canonical messages to the durable participant bounds before projecting detail.
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
		// 1. Current silo membership is a command prerequisite, not cached participant evidence.
		if (!await this.hasActiveCallerMembership(caller)) return null;

		// 2. Load mode, lifecycle, binding, and active-run facts with continuing participant access.
		const conversation = await this.prisma.conversation.findFirst({ where: { id: conversationId, siloId: caller.siloId, participants: { some: { userId: caller.subjectId, accessEndedPosition: null } } }, select: { mode: true, lifecycle: true, agentServiceId: true, runs: { where: { state: { notIn: [AgentRunState.Completed, AgentRunState.Failed, AgentRunState.Cancelled] } }, select: { id: true }, take: 2 } } });
		if (conversation === null || conversation.runs.length > 1) return null;

		// 3. Return only unambiguous durable strategy facts to the pure command decision.
		return { mode: _mode(conversation.mode), lifecycle: _LIFECYCLE_BY_PERSISTED_LIFECYCLE[conversation.lifecycle], agentServiceId: conversation.agentServiceId, activeRunId: conversation.runs[0]?.id ?? null };
	}

	/** Resolves one caller-owned idempotency-scoped canonical message. */
	async findOwnMessage(caller: ConversationCaller, conversationId: string, idempotencyKey: string): Promise<ConversationMessageView | null>
	{
		// 1. Revoked organisation membership invalidates even an otherwise exact retry key.
		if (!await this.hasActiveCallerMembership(caller)) return null;

		// 2. Resolve the key only while the caller retains active participant access.
		const entry = await this.prisma.conversationTimelineEntry.findFirst({ where: { conversationId, message: { is: { idempotencyKey, userId: caller.subjectId, conversation: { siloId: caller.siloId, participants: { some: { userId: caller.subjectId, accessEndedPosition: null } } } } } }, include: { message: true } });

		// 3. Project no foreign or access-ended durable message facts.
		return entry?.message ? _messageView(entry.message, entry.position) : null;
	}

	/** Detects a conversation-scoped key owned by another participant without returning their message. */
	async hasMessageIdempotencyKey(caller: ConversationCaller, conversationId: string, idempotencyKey: string): Promise<boolean>
	{
		// 1. A revoked caller cannot probe whether any participant owns the selected key.
		if (!await this.hasActiveCallerMembership(caller)) return false;

		// 2. Search only while the caller still has participant access to the conversation.
		const message = await this.prisma.conversationMessage.findFirst({ where: { conversationId, idempotencyKey, conversation: { siloId: caller.siloId, participants: { some: { userId: caller.subjectId, accessEndedPosition: null } } } }, select: { id: true } });

		// 3. Reveal only the collision boolean required by bounded conflict handling.
		return message !== null;
	}
}

/** Maps one Prisma aggregate to the transport-safe participant summary. */
function _summary(conversation: { id: string; mode: ConversationMode; lifecycle: ConversationLifecycle; agentServiceId: string | null; updatedAt: Date; participants: readonly { userId: string }[] }, participant: { archivedAt: Date | null; readThroughPosition: bigint }): ConversationSummary
{
	return { id: conversation.id, mode: _mode(conversation.mode), lifecycle: _LIFECYCLE_BY_PERSISTED_LIFECYCLE[conversation.lifecycle], agentServiceId: conversation.agentServiceId, participantUserIds: conversation.participants.map(function _UserId(row): string { return row.userId; }).sort(), archivedAt: participant.archivedAt?.toISOString() ?? null, readThroughPosition: participant.readThroughPosition.toString(10), updatedAt: conversation.updatedAt.toISOString() };
}

/** Maps a canonical persisted message and database-owned position. */
function _messageView(message: { id: string; role: ConversationMessageRole; state: ConversationMessageState; source: string; blocks: Prisma.JsonValue; runId: string | null; userId: string | null; createdAt: Date; completedAt: Date | null }, position: bigint): ConversationMessageView
{
	return { id: message.id, position: position.toString(10), role: _ROLE_BY_PERSISTED_ROLE[message.role], state: _STATE_BY_PERSISTED_STATE[message.state], source: _messageSource(message.source), blocks: message.blocks as unknown as readonly MessageContentBlock[], runId: message.runId, userId: message.userId, createdAt: message.createdAt.toISOString(), completedAt: message.completedAt?.toISOString() ?? null };
}

/** Validates the string-backed persistence column against the complete model-owned source vocabulary. */
function _messageSource(source: string): MessageSources
{
	if (source === MessageSources.UserInput) return MessageSources.UserInput;
	if (source === MessageSources.ModelOutput) return MessageSources.ModelOutput;
	if (source === MessageSources.ToolResult) return MessageSources.ToolResult;
	if (source === MessageSources.Platform) return MessageSources.Platform;
	throw new Error("Persisted conversation message source is unsupported");
}

/** Maps persisted enum vocabulary to the dependency-light model enum. */
function _mode(mode: ConversationMode): ConversationModes
{
	return _MODE_BY_PERSISTED_MODE[mode];
}
