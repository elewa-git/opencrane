import { ConversationLifecycles, ConversationModes, MessageRoles, MessageSources, MessageStates, type ConversationCreationRequest, type MessageContentBlock } from "@opencrane/models/conversations";
import type { AgentThreadOrigin, AgentThreadParentDelivery, AgentThreadTarget } from "@opencrane/backend/conversations/agent-threads";

/**
 * Who the caller is, as the server worked it out from the browser session.
 *
 * The router builds this itself from the session cookie and the request host — it is never
 * read from the request body, query string, or a header, so a client cannot ask to act as a
 * different user or in a different silo. Every method on {@link ConversationUnitOfWork} takes
 * one of these as its first argument, and the database layer re-checks the membership behind
 * it on each call rather than trusting it once at login.
 *
 * Called by: `_resolveCaller` in prisma-self-conversations.router.ts (built from
 * `_ResolveRequestPrincipal`), then passed through `__CreateSelfConversationsRouter`.
 */
export interface ConversationCaller
{
	/** ClusterTenant (silo) the request host resolves to; scopes every read and write below it. */
	readonly siloId: string;
	/** The user's OIDC `sub`, already verified by the session layer; matched against conversation participant rows. */
	readonly subjectId: string;
}

/**
 * Body accepted by {@link ConversationUnitOfWork.create}, already checked against the request
 * schema owned by `@opencrane/models/conversations`.
 *
 * The `mode` picked here (agent session, direct, or group) is fixed for the life of the
 * conversation — there is no API that changes it later, which is why the shape differs per
 * mode: an agent session names one `agentServiceId`, direct and group name participants.
 * Re-exported unchanged from the model package so the HTTP layer and the database layer
 * cannot drift apart.
 */
export type CreateConversationRequest = ConversationCreationRequest;

/**
 * One message a user is trying to post, after the router's size and shape checks passed.
 *
 * The blocks have already been limited (at most 32 blocks, 32000 characters each, by
 * `___ParticipantInputBlocksSchema`) so nothing downstream has to defend against an
 * unbounded body.
 *
 * @see {@link ConversationUnitOfWork.submitMessage} for what happens to it.
 */
export interface SubmitConversationMessageRequest
{
	/**
	 * Client-chosen retry key, unique per conversation. Resending the SAME key with the SAME
	 * blocks returns the stored message and outcome `idempotent`; resending it with DIFFERENT
	 * blocks is refused with {@link ConversationWriteDenialReasons.IdempotencyConflict}. The
	 * comparison is a digest of the blocks, so a client must reuse a key only for a true retry.
	 */
	readonly idempotencyKey: string;
	/** The message content, in display order. At least one block; order is preserved exactly as sent. */
	readonly blocks: readonly MessageContentBlock[];
	/** Exact structured target; accepted only for a root message in a group conversation. */
	readonly agentTarget?: AgentThreadTarget;
}

/**
 * One row in the caller's own conversation list.
 *
 * `archivedAt` and `readThroughPosition` are per-participant: archiving hides the
 * conversation for this user only and does not close it for anyone else. `lifecycle` is the
 * opposite — it is shared, and once it reads closed it never reopens.
 *
 * @see {@link ConversationDetail}, which adds the message history and the caller's visible
 * range.
 */
export interface ConversationSummary
{
	readonly id: string;
	readonly mode: ConversationModes;
	readonly lifecycle: ConversationLifecycles;
	readonly agentServiceId: string | null;
	readonly participantUserIds: readonly string[];
	readonly archivedAt: string | null;
	readonly readThroughPosition: string;
	readonly updatedAt: string;
}

/**
 * One stored message the caller is allowed to see.
 *
 * `position` is the shared timeline number as a decimal string (it is a 64-bit value in the
 * database, so it is not sent as a JSON number). Sort by it to get the true order — do not
 * sort by `createdAt`, which can tie. `runId` is set only when an agent run produced or
 * answered this message; `userId` is set only for human-authored messages.
 */
export interface ConversationMessageView
{
	readonly id: string;
	readonly position: string;
	readonly role: MessageRoles;
	readonly state: MessageStates;
	readonly source: MessageSources;
	readonly blocks: readonly MessageContentBlock[];
	readonly runId: string | null;
	readonly userId: string | null;
	readonly createdAt: string;
	readonly completedAt: string | null;
	/** Immutable child origin when this ordinary group message invoked an Agent. */
	readonly agentThread: AgentThreadOrigin | null;
}

/**
 * A single conversation plus the slice of its history this caller may read.
 *
 * `visibleFromPosition` is where the caller's access starts, and `accessEndedPosition` is
 * where it stopped (null while they are still a participant). A user added to a group part
 * way through therefore does not receive the earlier messages, and one removed later does not
 * receive the newer ones. `messages` is capped at the most recent 100 rows inside that range,
 * so it is not the whole conversation — stream the replay endpoint for everything.
 *
 * @see {@link ConversationUnitOfWork.open}
 */
export interface ConversationDetail extends ConversationSummary
{
	readonly visibleFromPosition: string;
	readonly accessEndedPosition: string | null;
	readonly messages: readonly ConversationMessageView[];
}

/** One serial governed run included in the bounded Agent-thread read model. */
export enum AgentThreadRunViewStates
{
	Queued = "queued",
	Working = "working",
	Waiting = "waiting",
	Retrying = "retrying",
	Completed = "completed",
	Failed = "failed",
	Cancelled = "cancelled",
}

/** One serial governed run included in the bounded Agent-thread read model. */
export interface AgentThreadRunView
{
	readonly id: string;
	readonly ordinal: number;
	readonly attempt: number;
	readonly state: AgentThreadRunViewStates;
	readonly acceptedAt: string;
	readonly finishedAt: string | null;
}

/** Canonical authorized child read model without participant login identifiers. */
export interface AgentThreadSnapshotView
{
	readonly parentConversationId: string;
	readonly childConversationId: string;
	readonly rootConversationId: string;
	readonly parentMessageId: string;
	readonly agentServiceId: string;
	readonly agentName: string;
	readonly ask: string;
	readonly createdAt: string;
	readonly lifecycle: ConversationLifecycles;
	readonly participantCount: number;
	readonly readThroughPosition: string;
	readonly latestPosition: string;
	readonly representedThroughPosition: string;
	readonly messageCount: number;
	/** Exact canonical message count after this participant's read coordinate. */
	readonly unreadMessageCount: number;
	/** Resume cursor for representedThroughPosition; never skips an omitted event. */
	readonly cursor: string | null;
	readonly messages: readonly ConversationMessageView[];
	readonly runs: readonly AgentThreadRunView[];
	readonly deliveries: readonly AgentThreadParentDelivery[];
}

/**
 * Why a conversation write was refused. These string values ARE the API contract: the router
 * sends the member value straight back as the `error` field, so renaming a value is a breaking
 * change for every client.
 *
 * Two rules govern the whole set:
 *
 * 1. Refusals are deliberately vague about other people's data. A conversation that does not
 *    exist, a conversation in another silo, and a conversation the caller was removed from all
 *    return `ConversationUnavailable`. Do not try to tell those apart, and do not add a reason
 *    that would — the shared value is what stops a client from probing for conversations it is
 *    not in.
 * 2. Anything unexpected becomes `PersistenceUnavailable` rather than a success. Nothing here
 *    means "probably worked".
 *
 * Each member maps to exactly one HTTP status in `_STATUS_BY_DENIAL`
 * (self-conversations.router.ts), so the retry advice below is what the status already implies.
 *
 * @see {@link ConversationAuthorityOutcomes} for the success side of the same results.
 */
export enum ConversationWriteDenialReasons
{
	/**
	 * Sent as 404. The conversation is not there for this caller — it may never have existed,
	 * may belong to another silo, or the caller may have lost their organisation membership.
	 * Callers must treat all three the same: drop the conversation from the UI. Retrying will
	 * not help.
	 */
	ConversationUnavailable = "conversation_unavailable",
	/**
	 * Sent as 409. The conversation is closed, and closing is one-way — no write will ever be
	 * accepted again. Stop retrying and disable the composer.
	 */
	ConversationClosed = "conversation_closed",
	/**
	 * Sent as 409. The command does not exist for this conversation's mode — for example asking
	 * an agent session to accept a plain group message. Since mode is fixed at creation, this
	 * is a client bug, not a timing problem; retrying never succeeds.
	 */
	CommandNotSupported = "command_not_supported",
	/**
	 * Sent as 409. An agent run for this conversation is still going, and only one may run at a
	 * time. This one clears by itself: wait for the run to finish (the replay stream reports it)
	 * and send again.
	 */
	ActiveRun = "active_run",
	/**
	 * Sent as 409. This `idempotencyKey` was already used in this conversation with different
	 * content. The stored message is NOT returned, because it may be another participant's.
	 * Generate a fresh key for genuinely new content; reuse a key only for a byte-identical
	 * retry, which returns {@link ConversationAuthorityOutcomes.Idempotent} instead.
	 */
	IdempotencyConflict = "idempotency_conflict",
	/**
	 * Sent as 404, only from create. At least one user named in `participantUserIds` has no
	 * active membership in this silo. Which one is not disclosed. Re-pick participants from a
	 * fresh directory read.
	 */
	ParticipantUnavailable = "participant_unavailable",
	/**
	 * Sent as 404. The agent service asked for cannot start a run — missing, retired, or with
	 * no usable revision or persona. Offer the user a different agent; retrying the same one
	 * will keep failing until an operator fixes it.
	 */
	AgentServiceUnavailable = "agent_service_unavailable",
	/**
	 * Sent as 429. The platform is at its concurrent-admission limit. Nothing is wrong with the
	 * request — back off and send the same body with the same `idempotencyKey` again.
	 */
	CapacityLimited = "capacity_limited",
	/**
	 * Sent as 503. The database refused or a write could not be confirmed. Whether it landed is
	 * unknown, so retry with the SAME `idempotencyKey`: if it did land the retry comes back as
	 * {@link ConversationAuthorityOutcomes.Idempotent}.
	 */
	PersistenceUnavailable = "persistence_unavailable",
}

/**
 * Alias used in the result unions below, so a denial is always one of
 * {@link ConversationWriteDenialReasons} and never a free-text string. Kept as its own name
 * because the internal callers (run admission, the mutation repository) map their own refusal
 * reasons onto this type before it reaches the wire — see `_runAdmissionDenial` in
 * prisma-conversation-unit-of-work.ts.
 */
export type ConversationWriteDenial = ConversationWriteDenialReasons;

/**
 * How a conversation write ended. Read this field first — it decides which other fields the
 * result object even has. `Denied` carries a `reason`; every other member carries the written
 * row instead.
 *
 * Only `Accepted` and `Idempotent` share a result type, and the difference matters:
 * `Accepted` means this call performed the write (the router answers 201), `Idempotent` means
 * an earlier identical call already did and this one changed nothing (200). A client that
 * treats them alike will double-count sends; a client that treats `Idempotent` as a failure
 * will show a duplicate-send error for a successful message.
 *
 * These string values go out on the wire in the `outcome` field, so they are part of the API
 * contract.
 *
 * @see {@link ConversationWriteDenialReasons} for what `Denied` can say.
 */
export enum ConversationAuthorityOutcomes
{
	/** Returned by create only: the conversation now exists, and the result carries its detail. */
	Created = "created",
	/** Returned by any write: nothing changed, and the result carries a denial reason instead of a row. */
	Denied = "denied",
	/** Returned by submitMessage: this call stored the message. The router answers 201. */
	Accepted = "accepted",
	/**
	 * Returned by submitMessage: this `idempotencyKey` and this exact body were already stored,
	 * so nothing new was written and the existing message is returned. The router answers 200.
	 * Not an error.
	 */
	Idempotent = "idempotent",
	/** Returned by setArchived and close: the conversation was updated, and its fresh detail is returned. */
	Changed = "changed",
}

/**
 * What {@link ConversationUnitOfWork.create} returns. Branch on `outcome`: `Created` gives you
 * the new conversation including its (initially empty) history; `Denied` gives a reason and no
 * conversation was written.
 *
 * @see {@link ConversationWriteDenialReasons.ParticipantUnavailable} and
 * {@link ConversationWriteDenialReasons.AgentServiceUnavailable}, the two denials only create
 * can produce.
 */
export type CreateConversationResult = { readonly outcome: ConversationAuthorityOutcomes.Created; readonly conversation: ConversationDetail } | { readonly outcome: ConversationAuthorityOutcomes.Denied; readonly reason: ConversationWriteDenial };

/**
 * What {@link ConversationUnitOfWork.submitMessage} returns. `Accepted` and `Idempotent` both
 * carry the stored message, so read `outcome` to know whether this call actually wrote
 * anything; `Denied` carries a reason and no message.
 *
 * For an agent-session conversation an `Accepted` result also means a run was started in the
 * same database transaction, so the message and the run can never exist without each other.
 */
export type SubmitConversationMessageResult = { readonly outcome: ConversationAuthorityOutcomes.Accepted | ConversationAuthorityOutcomes.Idempotent; readonly message: ConversationMessageView; readonly agentThread: AgentThreadOrigin | null } | { readonly outcome: ConversationAuthorityOutcomes.Denied; readonly reason: ConversationWriteDenial };

/**
 * What {@link ConversationUnitOfWork.setArchived} and {@link ConversationUnitOfWork.close}
 * return. `Changed` carries the conversation as it now stands, so a caller can render straight
 * from it without a follow-up read; `Denied` carries a reason and nothing was changed.
 */
export type MutateConversationResult = { readonly outcome: ConversationAuthorityOutcomes.Changed; readonly conversation: ConversationDetail } | { readonly outcome: ConversationAuthorityOutcomes.Denied; readonly reason: ConversationWriteDenial };

/**
 * Everything the conversation HTTP layer is allowed to do, as one port.
 *
 * Every method takes the {@link ConversationCaller} as its first argument and re-checks that
 * caller's membership in the database on each call, so a long-lived session cannot keep
 * writing after the user is removed from the silo. Each method also runs in its own database
 * transaction — reads at repeatable-read, writes at serializable — so there is no shared state
 * between calls and no ordering requirement between them.
 *
 * Failures arrive two different ways, and both must be handled: an expected refusal comes back
 * as a `Denied` result, while an unexpected database fault is THROWN. The router turns a throw
 * into 503.
 *
 * Called by: `__CreateSelfConversationsRouter` (self-conversations.router.ts) as
 * `dependencies.authority`. Implemented by `PrismaConversationUnitOfWork`
 * (prisma-conversation-unit-of-work.ts), wired up in `_CreateSelfConversationsRouter`
 * (prisma-self-conversations.router.ts) and mounted at `/api/v1/me/conversations` by
 * apps/opencrane/src/app/routes.ts.
 *
 * @see {@link ConversationReplayUnitOfWork} for the read-only streaming side.
 */
export interface ConversationUnitOfWork
{
	/**
	 * Lists the conversations this caller participates in, newest activity first.
	 *
	 * @param includeArchived - When false, conversations this caller archived are left out.
	 *   Archiving is per-participant, so this never hides a conversation from anyone else.
	 * @returns The caller's conversations. An empty array is a normal answer and does not mean
	 *   the caller lost access.
	 * @throws When the database is unreachable; the router answers 503.
	 */
	list(caller: ConversationCaller, includeArchived: boolean): Promise<readonly ConversationSummary[]>;
	/**
	 * Reads one conversation with the most recent 100 messages inside the caller's visible range.
	 *
	 * @returns The conversation, or null when this caller may not see it — which covers "no such
	 *   conversation", "another silo's conversation", and "was removed from it". The three are
	 *   deliberately not distinguished, and the router answers 404 for all of them.
	 * @throws When the database is unreachable.
	 */
	open(caller: ConversationCaller, conversationId: string): Promise<ConversationDetail | null>;
	/** Opens one bounded child snapshot only for current participants in both conversations. */
	openAgentThread(caller: ConversationCaller, parentConversationId: string, childConversationId: string): Promise<AgentThreadSnapshotView | null>;
	/**
	 * Creates one conversation and its participant rows in a single transaction, so a
	 * conversation with missing participants can never be left behind.
	 *
	 * @param request - Mode plus the fields that mode needs. Mode cannot be changed afterwards.
	 * @returns `Created` with the new conversation, or `Denied` with a reason.
	 * @throws When the database is unreachable.
	 */
	create(caller: ConversationCaller, request: CreateConversationRequest): Promise<CreateConversationResult>;
	/**
	 * Posts one message. In an agent-session conversation this also admits the agent run in the
	 * same transaction; in a direct or group conversation no run is created.
	 *
	 * @param request - Blocks plus the retry key. Resending the same key with the same blocks is
	 *   safe and returns `Idempotent`; the same key with different blocks is refused.
	 * @returns `Accepted` (written now), `Idempotent` (already written), or `Denied`.
	 * @throws When the database is unreachable, or when a unique-key collision cannot be
	 *   resolved into either a duplicate or a conflict.
	 */
	submitMessage(caller: ConversationCaller, conversationId: string, request: SubmitConversationMessageRequest): Promise<SubmitConversationMessageResult>;
	/**
	 * Hides or unhides the conversation in THIS caller's list only. It does not close the
	 * conversation, does not stop a run, and is invisible to the other participants.
	 *
	 * @returns `Changed` with the updated conversation, or `Denied`.
	 * @throws When the database is unreachable.
	 */
	setArchived(caller: ConversationCaller, conversationId: string, archived: boolean): Promise<MutateConversationResult>;
	/**
	 * Closes the conversation for everyone, permanently. There is no reopen.
	 *
	 * The database re-checks for a live run inside the transaction, so a run that starts while
	 * this call is in flight still blocks the close rather than being orphaned.
	 *
	 * @returns `Changed`, or `Denied` with
	 *   {@link ConversationWriteDenialReasons.ActiveRun} when a run is still going.
	 * @throws When the database is unreachable.
	 */
	close(caller: ConversationCaller, conversationId: string): Promise<MutateConversationResult>;
}
