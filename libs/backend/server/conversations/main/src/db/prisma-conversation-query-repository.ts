import { AgentRunState, AgentServiceKind, AgentServiceState, AgentThreadDeliveryKind, ConversationLifecycle, ConversationMessageRole, ConversationMessageState, ConversationMode, OrgMemberStatus, Prisma } from "@prisma/client";

import { ConversationLifecycles, ConversationModes, MessageRoles, MessageSources, MessageStates, type MessageContentBlock } from "@opencrane/models/conversations";
import { AgentThreadDeliveryKinds, type AgentThreadParentDelivery } from "@opencrane/backend/conversations/agent-threads";
import { __EncodeConversationProjectionCursor } from "@opencrane/backend/conversations/projection";

import { AgentThreadRunViewStates, type AgentThreadMessageView, type AgentThreadRunView, type AgentThreadSnapshotView } from "../types/agent-thread-view.types.js";
import type { ConversationCaller } from "../types/conversation-caller.types.js";
import { PersonalAgentDirectoryStatuses, type ConversationCreationDirectory } from "../types/conversation-directory.types.js";
import type { ConversationDetail, ConversationMessageView, ConversationSummary } from "../types/conversation-view.types.js";
import type { ConversationCommandContext, ConversationQueryRepository } from "./prisma-conversation-query-repository.types.js";

/** Maximum message rows returned by one participant-bound open operation. */
const _MESSAGE_LIMIT = 100;
/** Most recent runs in one Agent-thread snapshot. `firstRunOrdinal` keeps numbering right when cut. */
const _AGENT_THREAD_RUN_LIMIT = 100;
/** Most recent parent deliveries included in one Agent-thread snapshot. */
const _AGENT_THREAD_DELIVERY_LIMIT = 100;
/** Persisted roles rendered by the Agent-thread browser transcript and eligible for unread counts. */
const _AGENT_THREAD_VISIBLE_MESSAGE_ROLES: ConversationMessageRole[] = [ConversationMessageRole.User, ConversationMessageRole.Assistant];

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

/**
 * Reads conversations as one participant is allowed to see them, inside a transaction the caller
 * opened.
 *
 * It never opens a transaction of its own — it is constructed with whatever `Prisma.TransactionClient`
 * it is handed, which is how the same reads serve both a read-only query and a write that has to
 * check its own preconditions. {@link PrismaConversationUnitOfWork} builds it inside `_read`
 * (repeatable read) and `PrismaConversationMessageAdmissionUnitOfWork` does the same;
 * {@link PrismaConversationMutationRepository} builds it over its own serializable write
 * transaction, so a check made here and the write that follows see the same snapshot.
 *
 * Two rules hold across every method. Organisation membership is re-read on each call rather than
 * trusted from the session, so a removed user immediately stops being able to read. And nothing
 * leaves this class carrying a login subject: authors and participants are projected as opaque
 * OrgMembership references through {@link PrismaConversationQueryRepository._membershipReferences}.
 *
 * "Not visible to you" and "does not exist" are answered identically — an empty list or null — so a
 * caller cannot probe for other people's conversations.
 *
 * Called by: `PrismaConversationUnitOfWork._read`, `PrismaConversationMessageAdmissionUnitOfWork`,
 * and `PrismaConversationMutationRepository` (as its `query` collaborator).
 *
 * @see ConversationQueryRepository for the port this implements.
 */
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

	/**
	 * Lists everything the caller is allowed to choose from when starting a conversation: the other
	 * active members of their organisation, and their own personal Agent.
	 *
	 * This exists so the browser never has to hold a login identity. Each member is returned as an
	 * opaque OrgMembership reference, and those references are the only participant values creation
	 * accepts — see `_creationAuthority` in prisma-conversation-mutation-repository.ts, which resolves
	 * them again at write time. `openapi.test.ts` asserts the published response schema mentions
	 * neither `subject` nor `email`, and the router test asserts the response body does not contain
	 * the caller's own subject.
	 *
	 * The caller is in the list too, flagged `isSelf` — the workspace mapper uses it to recognise its own
	 * messages — but creation rejects that particular reference, since it adds the caller itself.
	 *
	 * @param caller - Session-derived silo and subject.
	 * @returns The member references plus a {@link PersonalAgentDirectoryStatuses} value: `Ready`
	 *   with the Agent to send back on creation, `Unavailable` when the caller has no runnable
	 *   personal Agent yet (so Agent-session creation will fail), or `Ambiguous` when more than one
	 *   Agent matches and the server refuses to guess — in the last two cases `personalAgent` is null
	 *   and a client must offer only direct and group conversations.
	 * @throws Error when the caller's own membership is not active in this silo. The route turns any
	 *   throw into 503, so a removed user is told "unavailable" rather than being handed a directory
	 *   of the organisation they just left.
	 */
	async directory(caller: ConversationCaller): Promise<ConversationCreationDirectory>
	{
		// 1. Read every active membership in the silo — this is both the answer and the authority
		// check, because the caller has to be one of the rows returned. Failing closed here is what
		// keeps a revoked member from listing the organisation.
		const memberships = await this.prisma.orgMembership.findMany({ where: { clusterTenant: caller.siloId, status: OrgMemberStatus.Active }, select: { id: true, subject: true }, orderBy: { id: "asc" } });
		if (!memberships.some(function _Caller(row): boolean { return row.subject === caller.subjectId; })) throw new Error("Conversation directory membership unavailable");

		// 2. Find the persona revision the approval flow made active on the caller's profile, then the
		// Agent services built from that exact revision. Without an active revision there is nothing to
		// run, so the Agent lookup is skipped entirely. `take: 2` is enough to detect "more than one".
		const profile = await this.prisma.personaProfile.findUnique({ where: { siloId_userId: { siloId: caller.siloId, userId: caller.subjectId } }, select: { activeRevisionId: true } });
		const services = profile?.activeRevisionId === null || profile?.activeRevisionId === undefined
			? []
			: await this.prisma.agentService.findMany({ where: { siloId: caller.siloId, kind: AgentServiceKind.Personal, state: AgentServiceState.Active, activeRevisionId: { not: null }, activeRevision: { is: { personaRevisionId: profile.activeRevisionId } } }, select: { id: true, name: true }, orderBy: { id: "asc" }, take: 2 });

		// 3. Return membership row ids as the participant references, and report ambiguity instead of
		// resolving it: two active Agents on one persona revision means Agent ownership is unclear, and
		// silently starting a conversation with the wrong one is worse than offering none.
		const participants = memberships.map(function _Participant(row) { return { participantRef: row.id, isSelf: row.subject === caller.subjectId }; });
		if (services.length > 1) return { participants, personalAgentStatus: PersonalAgentDirectoryStatuses.Ambiguous, personalAgent: null };
		const service = services[0];
		if (service === undefined) return { participants, personalAgentStatus: PersonalAgentDirectoryStatuses.Unavailable, personalAgent: null };
		return { participants, personalAgentStatus: PersonalAgentDirectoryStatuses.Ready, personalAgent: { personalAgentRef: service.id, displayName: service.name } };
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

		// 3. Project the summaries, first translating every participant subject into its opaque
		// membership reference. One extra query covers the whole page instead of one per conversation.
		const subjects = participants.flatMap(function _Subjects(participant): readonly string[] { return participant.conversation.participants.map(function _Subject(row): string { return row.userId; }); });
		const references = await this._membershipReferences(caller.siloId, subjects);
		return participants.map(function _Summary(participant): ConversationSummary { return _summary(participant.conversation, participant, references); });
	}

	/** Returns the exact participant-visible aggregate and latest canonical message window. */
	async open(caller: ConversationCaller, conversationId: string): Promise<ConversationDetail | null>
	{
		// 1. Membership revocation denies the aggregate before its existence can be disclosed.
		if (!await this.hasActiveCallerMembership(caller)) return null;

		// 2. Resolve the exact participant visibility coordinates inside this membership snapshot.
		const participant = await this.prisma.conversationParticipant.findFirst({ where: { conversationId, userId: caller.subjectId, conversation: _ConversationAccess(caller) }, include: { conversation: { include: { participants: { select: { userId: true } } } } } });
		if (participant === null) return null;

		// 3. Clip canonical messages to the durable participant bounds before projecting detail. Both
		// the participant list and every message author are translated to membership references in one
		// query, because a message author may have left the conversation and still needs a reference.
		const entries = await this.prisma.conversationTimelineEntry.findMany({ where: { conversationId, position: { gte: participant.visibleFromPosition, ...(participant.accessEndedPosition === null ? {} : { lte: participant.accessEndedPosition }) }, messageId: { not: null } }, include: { message: { include: { invokedAgentThread: true } } }, orderBy: { position: "desc" }, take: _MESSAGE_LIMIT });
		const subjects = [...participant.conversation.participants.map(function _Subject(row): string { return row.userId; }), ...entries.flatMap(function _Author(entry): readonly string[] { return entry.message?.userId === null || entry.message?.userId === undefined ? [] : [entry.message.userId]; })];
		const references = await this._membershipReferences(caller.siloId, subjects);
		return {
			..._summary(participant.conversation, participant, references),
			visibleFromPosition: participant.visibleFromPosition.toString(10),
			accessEndedPosition: participant.accessEndedPosition?.toString(10) ?? null,
			messages: [...entries].reverse().flatMap(function _Message(entry): readonly ConversationMessageView[] { return entry.message === null ? [] : [_messageView(entry.message, entry.position, references)]; }),
		};
	}

	/**
	 * Builds the whole view of one Agent thread: the question asked, the child transcript, its runs, and
	 * what has been reported back to the parent.
	 *
	 * Access is proven on both conversations, so losing access to the parent also ends access to the
	 * thread. `representedThroughPosition` and `cursor` stop at the first timeline entry that has no
	 * message — those entries only exist as live stream events, so a snapshot that claimed to cover them
	 * would make a client skip them when it reconnects. `unreadMessageCount` counts only user and
	 * assistant messages, since tool and platform rows are not shown in the transcript.
	 *
	 * @returns The snapshot, or null when the thread does not exist, is not this caller's to read, or has
	 *   lost its Agent service — the cases are not distinguished.
	 */
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
		const unreadMessageCount = await this.prisma.conversationTimelineEntry.count({ where: { conversationId: childConversationId, messageId: { not: null }, message: { is: { role: { in: _AGENT_THREAD_VISIBLE_MESSAGE_ROLES } } }, position: { gt: participant.readThroughPosition } } });
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
		if (entry?.message === null || entry?.message === undefined) return null;
		const references = await this._membershipReferences(caller.siloId, entry.message.userId === null ? [] : [entry.message.userId]);
		return _messageView(entry.message, entry.position, references);
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

	/**
	 * Looks up the opaque reference to publish for each login subject, in one query.
	 *
	 * Membership status is deliberately not filtered here, unlike every authority check in this class:
	 * a past participant or the author of an old message still has to be nameable, otherwise reading
	 * history would break as soon as someone left the organisation. Deciding what the caller may see
	 * has already happened by the time this runs.
	 *
	 * @param siloId - The caller's silo; references are only meaningful inside it.
	 * @param subjects - Login subjects gathered from participant and message rows; duplicates are fine.
	 * @returns Subject to membership-reference map, empty when nothing was asked for.
	 * @throws Error when a subject has no membership row in this silo. Failing the whole read is
	 *   intentional: the alternative would be projecting the raw subject, which is the identifier this
	 *   whole indirection exists to keep out of responses.
	 */
	private async _membershipReferences(siloId: string, subjects: readonly string[]): Promise<ReadonlyMap<string, string>>
	{
		const uniqueSubjects = [...new Set(subjects)];
		if (uniqueSubjects.length === 0) return new Map();
		const memberships = await this.prisma.orgMembership.findMany({ where: { clusterTenant: siloId, subject: { in: uniqueSubjects } }, select: { id: true, subject: true } });
		const references = new Map(memberships.map(function _Reference(row): readonly [string, string] { return [row.subject, row.id]; }));
		if (references.size !== uniqueSubjects.length) throw new Error("Conversation participant reference unavailable");
		return references;
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

/**
 * Maps one Prisma aggregate to the summary the API returns.
 *
 * `references` must already cover every participant subject on the conversation; a missing one
 * throws rather than being skipped, so a caller cannot receive a short participant list that looks
 * like a smaller conversation. The refs are sorted so the same conversation always serialises the
 * same way.
 */
function _summary(conversation: { id: string; mode: ConversationMode; lifecycle: ConversationLifecycle; agentServiceId: string | null; updatedAt: Date; participants: readonly { userId: string }[] }, participant: { archivedAt: Date | null; readThroughPosition: bigint }, references: ReadonlyMap<string, string>): ConversationSummary
{
	return { id: conversation.id, mode: _mode(conversation.mode), lifecycle: _LIFECYCLE_BY_PERSISTED_LIFECYCLE[conversation.lifecycle], agentServiceId: conversation.agentServiceId, participantRefs: conversation.participants.map(function _Participant(row): string { return _requireParticipantRef(references, row.userId); }).sort(), archivedAt: participant.archivedAt?.toISOString() ?? null, readThroughPosition: participant.readThroughPosition.toString(10), updatedAt: conversation.updatedAt.toISOString() };
}

/**
 * Maps a canonical persisted message and database-owned position.
 *
 * The author is published as `participantRef`, never as the stored `userId`, and stays null for
 * anything a person did not write — the database's `conversation_messages_provenance_check` allows
 * `user_id` only on `user_input` rows.
 */
function _messageView(message: { id: string; role: ConversationMessageRole; state: ConversationMessageState; source: string; blocks: Prisma.JsonValue; runId: string | null; userId: string | null; createdAt: Date; completedAt: Date | null; invokedAgentThread: { childConversationId: string; parentConversationId: string; rootConversationId: string; parentMessageId: string; initiatorUserId: string; agentServiceId: string; personaRevisionId: string; firstRunId: string } | null }, position: bigint, references: ReadonlyMap<string, string>): ConversationMessageView
{
	return { id: message.id, position: position.toString(10), role: _ROLE_BY_PERSISTED_ROLE[message.role], state: _STATE_BY_PERSISTED_STATE[message.state], source: _messageSource(message.source), blocks: message.blocks as unknown as readonly MessageContentBlock[], runId: message.runId, participantRef: message.userId === null ? null : _requireParticipantRef(references, message.userId), createdAt: message.createdAt.toISOString(), completedAt: message.completedAt?.toISOString() ?? null, agentThread: message.invokedAgentThread ?? null };
}

/**
 * Maps a child Agent-thread message, naming no author at all.
 *
 * It repeats the field mapping instead of calling {@link _messageView} because that function now
 * needs a reference map to publish an author, and this view has no author field to publish into —
 * an Agent thread shows the Agent's work, not who in the parent conversation asked for it.
 */
function _agentThreadMessageView(message: Parameters<typeof _messageView>[0], position: bigint): AgentThreadMessageView
{
	return { id: message.id, position: position.toString(10), role: _ROLE_BY_PERSISTED_ROLE[message.role], state: _STATE_BY_PERSISTED_STATE[message.state], source: _messageSource(message.source), blocks: message.blocks as unknown as readonly MessageContentBlock[], runId: message.runId, createdAt: message.createdAt.toISOString(), completedAt: message.completedAt?.toISOString() ?? null };
}

/**
 * Reads one reference out of the prepared map, and refuses to fall back to the subject.
 *
 * @param references - Map built by `PrismaConversationQueryRepository._membershipReferences`.
 * @param subjectId - Login subject taken from a participant or message row.
 * @returns The opaque reference for that subject.
 * @throws Error when the map has no entry. The message names no identifier, so a 503 response and
 *   the server log both stay free of the subject.
 */
function _requireParticipantRef(references: ReadonlyMap<string, string>, subjectId: string): string
{
	const reference = references.get(subjectId);
	if (reference === undefined) throw new Error("Conversation participant reference unavailable");
	return reference;
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
