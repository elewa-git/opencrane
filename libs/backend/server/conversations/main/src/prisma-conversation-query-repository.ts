import { AgentRunState, AgentThreadDeliveryKind, ConversationLifecycle, ConversationMessageRole, ConversationMessageState, ConversationMode, OrgMemberStatus, Prisma } from "@prisma/client";

import { ConversationLifecycles, ConversationModes, MessageRoles, MessageSources, MessageStates, type MessageContentBlock } from "@opencrane/models/conversations";
import { AgentThreadDeliveryKinds, type AgentThreadParentDelivery } from "@opencrane/backend/conversations/agent-threads";
import { __EncodeConversationProjectionCursor } from "@opencrane/backend/conversations/projection";

import { AgentThreadRunViewStates, type AgentThreadMessageView, type AgentThreadRunView, type AgentThreadSnapshotView, type ConversationCaller, type ConversationDetail, type ConversationMessageView, type ConversationSummary } from "./conversation-authority.types.js";
import type { ConversationCommandContext, ConversationQueryRepository } from "./prisma-conversation-query-repository.types.js";

/** Maximum message rows returned by one participant-bound open operation. */
const _MESSAGE_LIMIT = 100;
const _AGENT_THREAD_RUN_LIMIT = 100;
const _AGENT_THREAD_DELIVERY_LIMIT = 100;

/** Database mode enum to API mode enum. Typed as a complete record, so adding a mode to the schema without mapping it fails the build. */
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
			where: { userId: caller.subjectId, conversation: _ConversationAccess(caller), ...(includeArchived ? {} : { archivedAt: null }) },
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
		const participant = await this.prisma.conversationParticipant.findFirst({ where: { conversationId, userId: caller.subjectId, conversation: _ConversationAccess(caller) }, include: { conversation: { include: { participants: { select: { userId: true } } } } } });
		if (participant === null) return null;

		// 3. Clip canonical messages to the durable participant bounds before projecting detail.
		const entries = await this.prisma.conversationTimelineEntry.findMany({ where: { conversationId, position: { gte: participant.visibleFromPosition, ...(participant.accessEndedPosition === null ? {} : { lte: participant.accessEndedPosition }) }, messageId: { not: null } }, include: { message: { include: { invokedAgentThread: true } } }, orderBy: { position: "desc" }, take: _MESSAGE_LIMIT });
		return {
			..._summary(participant.conversation, participant),
			visibleFromPosition: participant.visibleFromPosition.toString(10),
			accessEndedPosition: participant.accessEndedPosition?.toString(10) ?? null,
			messages: [...entries].reverse().flatMap(function _Message(entry): readonly ConversationMessageView[] { return entry.message === null ? [] : [_messageView(entry.message, entry.position)]; }),
		};
	}

	/** Composes one bounded child view from the canonical child, run, and delivery authorities. */
	async openAgentThread(caller: ConversationCaller, parentConversationId: string, childConversationId: string): Promise<AgentThreadSnapshotView | null>
	{
		if (!await this.hasActiveCallerMembership(caller)) return null;
		const thread = await this.prisma.conversationAgentThread.findFirst({
			where: {
				parentConversationId,
				childConversationId,
				siloId: caller.siloId,
				parentConversation: { participants: { some: { userId: caller.subjectId, accessEndedPosition: null } } },
				childConversation: { participants: { some: { userId: caller.subjectId, accessEndedPosition: null } } },
			},
			include: {
				parentMessage: { select: { blocks: true, createdAt: true } },
				parentConversation: { select: { participants: { where: { accessEndedPosition: null }, select: { userId: true } } } },
				childConversation: {
					select: {
						lifecycle: true,
						service: { select: { name: true } },
						_count: { select: { messages: true, runs: true } },
						participants: { where: { accessEndedPosition: null }, select: { userId: true, readThroughPosition: true } },
						runs: { orderBy: [{ acceptedAt: "desc" }, { id: "desc" }], take: _AGENT_THREAD_RUN_LIMIT, select: { id: true, attempt: true, state: true, acceptedAt: true, finishedAt: true } },
					},
				},
				deliveries: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: _AGENT_THREAD_DELIVERY_LIMIT },
			},
		});
		if (thread === null || thread.childConversation.service === null) return null;
		const participant = thread.childConversation.participants.find(function _Caller(row) { return row.userId === caller.subjectId; });
		if (participant === undefined) return null;
		const activeParentUserIds = new Set(thread.parentConversation.participants.map(function _ParentUser(row) { return row.userId; }));
		const timeline = await this.prisma.conversationTimelineEntry.findMany({ where: { conversationId: childConversationId }, include: { message: { include: { invokedAgentThread: true } } }, orderBy: { position: "asc" }, take: _MESSAGE_LIMIT });
		const entries = timeline.filter(function _MessageEntry(entry) { return entry.messageId !== null && entry.message !== null; });
		const representedEntries = _RepresentedMessagePrefix(timeline);
		const latestEntry = await this.prisma.conversationTimelineEntry.findFirst({ where: { conversationId: childConversationId }, orderBy: { position: "desc" }, select: { position: true } });
		const unreadMessageCount = await this.prisma.conversationTimelineEntry.count({ where: { conversationId: childConversationId, messageId: { not: null }, position: { gt: participant.readThroughPosition } } });
		const representedPosition = representedEntries.at(-1)?.position ?? 0n;
		const latestPosition = latestEntry?.position ?? 0n;
		const runs = [...thread.childConversation.runs].reverse();
		const firstRunOrdinal = thread.childConversation._count.runs - runs.length + 1;
		return {
			parentConversationId,
			childConversationId,
			rootConversationId: thread.rootConversationId,
			parentMessageId: thread.parentMessageId,
			agentServiceId: thread.agentServiceId,
			agentName: thread.childConversation.service.name,
			ask: _Text(thread.parentMessage.blocks),
			createdAt: thread.createdAt.toISOString(),
			lifecycle: _LIFECYCLE_BY_PERSISTED_LIFECYCLE[thread.childConversation.lifecycle],
			participantCount: thread.childConversation.participants.filter(function _ActiveParent(row) { return activeParentUserIds.has(row.userId); }).length,
			readThroughPosition: participant.readThroughPosition.toString(10),
			latestPosition: latestPosition.toString(10),
			representedThroughPosition: representedPosition.toString(10),
			messageCount: thread.childConversation._count.messages,
			unreadMessageCount,
			cursor: representedPosition === 0n ? null : __EncodeConversationProjectionCursor({ conversationId: childConversationId, position: representedPosition.toString(10) }),
			messages: entries.flatMap(function _Message(entry): readonly AgentThreadMessageView[] { return entry.message === null ? [] : [_agentThreadMessageView(entry.message, entry.position)]; }),
			runs: runs.map(function _Run(run, index): AgentThreadRunView { return { id: run.id, ordinal: firstRunOrdinal + index, attempt: run.attempt, state: _RunState(run.state), acceptedAt: run.acceptedAt.toISOString(), finishedAt: run.finishedAt?.toISOString() ?? null }; }),
			deliveries: [...thread.deliveries].reverse().map(_Delivery),
		};
	}

	/** Loads exact durable mode, lifecycle, binding, and foreground-run strategy facts. */
	async loadCommandContext(caller: ConversationCaller, conversationId: string): Promise<ConversationCommandContext | null>
	{
		// 1. Current silo membership is a command prerequisite, not cached participant evidence.
		if (!await this.hasActiveCallerMembership(caller)) return null;

		// 2. Load mode, lifecycle, binding, and active-run facts with continuing participant access.
		const conversation = await this.prisma.conversation.findFirst({ where: { id: conversationId, ..._ConversationAccess(caller), participants: { some: { userId: caller.subjectId, accessEndedPosition: null } } }, select: { mode: true, lifecycle: true, agentServiceId: true, runs: { where: { state: { notIn: [AgentRunState.Completed, AgentRunState.Failed, AgentRunState.Cancelled] } }, select: { id: true }, take: 2 } } });
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
		const entry = await this.prisma.conversationTimelineEntry.findFirst({ where: { conversationId, message: { is: { idempotencyKey, userId: caller.subjectId, conversation: { ..._ConversationAccess(caller), participants: { some: { userId: caller.subjectId, accessEndedPosition: null } } } } } }, include: { message: { include: { invokedAgentThread: true } } } });

		// 3. Project no foreign or access-ended durable message facts.
		return entry?.message ? _messageView(entry.message, entry.position) : null;
	}

	/** Detects a conversation-scoped key owned by another participant without returning their message. */
	async hasMessageIdempotencyKey(caller: ConversationCaller, conversationId: string, idempotencyKey: string): Promise<boolean>
	{
		// 1. A revoked caller cannot probe whether any participant owns the selected key.
		if (!await this.hasActiveCallerMembership(caller)) return false;

		// 2. Search only while the caller still has participant access to the conversation.
		const message = await this.prisma.conversationMessage.findFirst({ where: { conversationId, idempotencyKey, conversation: { ..._ConversationAccess(caller), participants: { some: { userId: caller.subjectId, accessEndedPosition: null } } } }, select: { id: true } });

		// 3. Reveal only the collision boolean required by bounded conflict handling.
		return message !== null;
	}
}

/** Keep the snapshot cursor before the first timeline event that only the live projection can render. */
function _RepresentedMessagePrefix<TRow extends { readonly messageId: string | null; readonly message: unknown }>(timeline: readonly TRow[]): readonly TRow[]
{
	const firstStreamOnlyEvent = timeline.findIndex(function _StreamOnly(entry) { return entry.messageId === null || entry.message === null; });
	return firstStreamOnlyEvent === -1 ? timeline : timeline.slice(0, firstStreamOnlyEvent);
}

/**
 * Keep child Agent-session authority coupled to the current immediate-parent participant set.
 *
 * The child participant row is an immutable creation-time mirror. Every later read and command
 * therefore also proves that a child reader is still active in the parent; ordinary root
 * conversations take the first branch and retain their normal durable participant bounds.
 */
function _ConversationAccess(caller: ConversationCaller): Prisma.ConversationWhereInput
{
	return {
		siloId: caller.siloId,
		OR: [
			{ originAgentThread: { is: null } },
			{ originAgentThread: { is: { parentConversation: { participants: { some: { userId: caller.subjectId, accessEndedPosition: null } } } } } },
		],
	};
}

/** Extract only display-safe participant text from the immutable root message. */
function _Text(blocks: Prisma.JsonValue): string
{
	if (!Array.isArray(blocks)) return "";
	return blocks.flatMap(function _Block(block): readonly string[]
	{
		if (block === null || typeof block !== "object" || Array.isArray(block)) return [];
		return block["kind"] === "text" && typeof block["value"] === "string" ? [block["value"]] : [];
	}).join("\n");
}

/** Map one canonical run state into the finite Agent-thread UI vocabulary. */
function _RunState(state: AgentRunState): AgentThreadRunView["state"]
{
	if (state === AgentRunState.Completed) return AgentThreadRunViewStates.Completed;
	if (state === AgentRunState.Failed) return AgentThreadRunViewStates.Failed;
	if (state === AgentRunState.Cancelled) return AgentThreadRunViewStates.Cancelled;
	if (state === AgentRunState.WaitingForInput) return AgentThreadRunViewStates.Waiting;
	if (state === AgentRunState.RecoveryRequired) return AgentThreadRunViewStates.Retrying;
	if (state === AgentRunState.Running || state === AgentRunState.Assigned || state === AgentRunState.Cancelling) return AgentThreadRunViewStates.Working;
	return AgentThreadRunViewStates.Queued;
}

/** Map one display-safe delivery without leaking runtime authority coordinates. */
function _Delivery(row: { id: string; childConversationId: string; parentConversationId: string; runId: string; kind: AgentThreadDeliveryKind; label: string; detail: string; assetId: string | null; createdAt: Date }): AgentThreadParentDelivery
{
	const kinds: Readonly<Record<AgentThreadDeliveryKind, AgentThreadDeliveryKinds>> = {
		[AgentThreadDeliveryKind.Status]: AgentThreadDeliveryKinds.Status,
		[AgentThreadDeliveryKind.Question]: AgentThreadDeliveryKinds.Question,
		[AgentThreadDeliveryKind.Approval]: AgentThreadDeliveryKinds.Approval,
		[AgentThreadDeliveryKind.Result]: AgentThreadDeliveryKinds.Result,
		[AgentThreadDeliveryKind.Failure]: AgentThreadDeliveryKinds.Failure,
		[AgentThreadDeliveryKind.Asset]: AgentThreadDeliveryKinds.Asset,
	};
	return { id: row.id, childConversationId: row.childConversationId, parentConversationId: row.parentConversationId, runId: row.runId, kind: kinds[row.kind], label: row.label, detail: row.detail, assetId: row.assetId, createdAt: row.createdAt.toISOString() };
}

/** Maps one Prisma aggregate to the transport-safe participant summary. */
function _summary(conversation: { id: string; mode: ConversationMode; lifecycle: ConversationLifecycle; agentServiceId: string | null; updatedAt: Date; participants: readonly { userId: string }[] }, participant: { archivedAt: Date | null; readThroughPosition: bigint }): ConversationSummary
{
	return { id: conversation.id, mode: _mode(conversation.mode), lifecycle: _LIFECYCLE_BY_PERSISTED_LIFECYCLE[conversation.lifecycle], agentServiceId: conversation.agentServiceId, participantUserIds: conversation.participants.map(function _UserId(row): string { return row.userId; }).sort(), archivedAt: participant.archivedAt?.toISOString() ?? null, readThroughPosition: participant.readThroughPosition.toString(10), updatedAt: conversation.updatedAt.toISOString() };
}

/** Maps a canonical persisted message and database-owned position. */
function _messageView(message: { id: string; role: ConversationMessageRole; state: ConversationMessageState; source: string; blocks: Prisma.JsonValue; runId: string | null; userId: string | null; createdAt: Date; completedAt: Date | null; invokedAgentThread: { childConversationId: string; parentConversationId: string; rootConversationId: string; parentMessageId: string; initiatorUserId: string; agentServiceId: string; personaRevisionId: string; firstRunId: string } | null }, position: bigint): ConversationMessageView
{
	return { id: message.id, position: position.toString(10), role: _ROLE_BY_PERSISTED_ROLE[message.role], state: _STATE_BY_PERSISTED_STATE[message.state], source: _messageSource(message.source), blocks: message.blocks as unknown as readonly MessageContentBlock[], runId: message.runId, userId: message.userId, createdAt: message.createdAt.toISOString(), completedAt: message.completedAt?.toISOString() ?? null, agentThread: message.invokedAgentThread ?? null };
}

/** Maps a child message without participant login identifiers or nested thread authority. */
function _agentThreadMessageView(message: Parameters<typeof _messageView>[0], position: bigint): AgentThreadMessageView
{
	const projected = _messageView(message, position);
	return { id: projected.id, position: projected.position, role: projected.role, state: projected.state, source: projected.source, blocks: projected.blocks, runId: projected.runId, createdAt: projected.createdAt, completedAt: projected.completedAt };
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
