import type { AgentThreadSnapshotView } from "./agent-thread-view.types.js";
import type { CreateConversationResult, MarkAgentThreadReadResult, MutateConversationResult, RetryConversationRunResult, SubmitConversationMessageResult } from "./conversation-authority-result.types.js";
import type { ConversationCaller } from "./conversation-caller.types.js";
import type { ConversationCreationDirectory } from "./conversation-directory.types.js";
import type { CreateConversationRequest, RetryConversationRunRequest, SubmitConversationMessageRequest } from "./conversation-request.types.js";
import type { ConversationDetail, ConversationSummary } from "./conversation-view.types.js";

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
	/** Lists self-scoped creation choices without returning login subjects, emails, roles, or memory identity. */
	directory(caller: ConversationCaller): Promise<ConversationCreationDirectory>;
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
	/** Advances this caller's child read position only up to the canonical position they observed. */
	markAgentThreadRead(caller: ConversationCaller, parentConversationId: string, childConversationId: string, observedPosition: string): Promise<MarkAgentThreadReadResult>;
	/** Starts one fresh attempt through the run-owned compare-and-swap authority. */
	retryRun(caller: ConversationCaller, conversationId: string, runId: string, request: RetryConversationRunRequest): Promise<RetryConversationRunResult>;
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
