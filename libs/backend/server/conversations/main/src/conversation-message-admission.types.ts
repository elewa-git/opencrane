import type { ConversationCaller, ConversationMessageView, SubmitConversationMessageRequest, SubmitConversationMessageResult } from "./conversation-authority.types.js";
import type { ConversationCommandContext } from "./prisma-conversation-query-repository.types.js";
import type { RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";

/** Transaction-bound participant attachment admission owned by conversation assets. */
export interface ConversationAttachmentAdmissionPort
{
	/** Bind every referenced ready asset to the newly persisted message or roll the transaction back. */
	bindReadyAssets(caller: ConversationCaller, conversationId: string, messageId: string, blocks: SubmitConversationMessageRequest["blocks"]): Promise<void>;
	/** Copy ready parent asset references into a child conversation without copying stored bytes. */
	mirrorReadyAssets(caller: ConversationCaller, parentConversationId: string, childConversationId: string, childMessageId: string, parentBlocks: SubmitConversationMessageRequest["blocks"], childBlocks: SubmitConversationMessageRequest["blocks"]): Promise<void>;
}

/** Creates attachment admission over an already-open conversation/run transaction. */
export interface ConversationAttachmentAdmissionFactory
{
	(transaction: Pick<RunAdmissionTransaction, "prisma">): ConversationAttachmentAdmissionPort;
}

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
