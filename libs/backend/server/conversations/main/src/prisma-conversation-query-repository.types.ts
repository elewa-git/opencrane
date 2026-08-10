import type { ConversationLifecycles, ConversationModes } from "@opencrane/models/conversations";

import type { ConversationCaller, ConversationDetail, ConversationMessageView, ConversationSummary } from "./conversation-authority.types.js";

/** Durable facts required by the pure immutable-mode command strategy. */
export interface ConversationCommandContext
{
	readonly mode: ConversationModes;
	readonly lifecycle: ConversationLifecycles;
	readonly agentServiceId: string | null;
	readonly activeRunId: string | null;
}

/** Participant-scoped durable conversation reads over one exact transaction snapshot. */
export interface ConversationQueryRepository
{
	list(caller: ConversationCaller, includeArchived: boolean): Promise<readonly ConversationSummary[]>;
	open(caller: ConversationCaller, conversationId: string): Promise<ConversationDetail | null>;
	loadCommandContext(caller: ConversationCaller, conversationId: string): Promise<ConversationCommandContext | null>;
	findOwnMessage(caller: ConversationCaller, conversationId: string, idempotencyKey: string): Promise<ConversationMessageView | null>;
	hasMessageIdempotencyKey(caller: ConversationCaller, conversationId: string, idempotencyKey: string): Promise<boolean>;
}
