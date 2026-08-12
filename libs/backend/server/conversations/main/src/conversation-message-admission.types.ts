import type { ConversationCaller, ConversationMessageView, SubmitConversationMessageRequest, SubmitConversationMessageResult } from "./conversation-authority.types.js";
import type { ConversationCommandContext } from "./prisma-conversation-query-repository.types.js";

/** Internal authority that owns participant-message admission and retry semantics. */
export interface ConversationMessageAdmissionUnitOfWork
{
	/** Admits, deduplicates, or denies one participant-authored message. */
	submit(caller: ConversationCaller, conversationId: string, request: SubmitConversationMessageRequest): Promise<SubmitConversationMessageResult>;
}

/** Participant-scoped duplicate and strategy facts read before message admission. */
export interface ConversationMessageSubmissionPreflight
{
	/** Exact caller-owned message already persisted for this idempotency key. */
	readonly duplicate: ConversationMessageView | null;
	/** Persisted mode and lifecycle facts when the request is not already committed. */
	readonly context: ConversationCommandContext | null;
}

/** Safe classification of a failed message insert's idempotency coordinate. */
export interface ConversationMessageIdempotencyConflict
{
	/** Existing message only when it belongs to the current participant. */
	readonly duplicate: ConversationMessageView | null;
	/** Whether any message already owns the conversation-scoped key. */
	readonly exists: boolean;
}
