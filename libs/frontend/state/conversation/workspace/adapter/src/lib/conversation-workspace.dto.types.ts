/** Generated directory fields adopted by the browser adapter. */
export interface ConversationDirectoryDto
{
	/** Opaque human choices. */
	readonly participants: readonly { readonly participantRef: string; readonly isSelf: boolean }[];
	/** Server-owned personal Agent availability. */
	readonly personalAgentStatus: string;
	/** Sole active personal Agent, when available. */
	readonly personalAgent: { readonly personalAgentRef: string; readonly displayName: string } | null;
}

/** Generated summary fields adopted by the browser adapter. */
export interface ConversationSummaryDto
{
	/** Opaque conversation coordinate. */
	readonly id: string;
	/** Serialized immutable mode. */
	readonly mode: string;
	/** Serialized lifecycle. */
	readonly lifecycle: string;
	/** Optional Agent service coordinate. */
	readonly agentServiceId: string | null;
	/** Opaque human participant coordinates. */
	readonly participantRefs: readonly string[];
	/** Participant-local archive time. */
	readonly archivedAt: string | null;
	/** Latest update time. */
	readonly updatedAt: string;
}

/** Generated message fields adopted by the browser adapter. */
export interface ConversationMessageDto
{
	/** Stable message coordinate. */
	readonly id: string;
	/** Decimal timeline position. */
	readonly position: string;
	/** Serialized role. */
	readonly role: string;
	/** Serialized lifecycle. */
	readonly state: string;
	/** Serialized source. */
	readonly source: string;
	/** Ordered content blocks. */
	readonly blocks: readonly { readonly id: string; readonly kind: string; readonly value: string }[];
	/** Optional run coordinate. */
	readonly runId: string | null;
	/** Optional opaque human author coordinate. */
	readonly participantRef: string | null;
	/** Server timestamp. */
	readonly createdAt: string;
	/** Optional immutable child origin. */
	readonly agentThread: { readonly childConversationId: string; readonly parentMessageId: string } | null;
}

/** Generated detail fields adopted by the browser adapter. */
export interface ConversationDetailDto extends ConversationSummaryDto
{
	/** First visible position. */
	readonly visibleFromPosition: string;
	/** Last visible position after access ends. */
	readonly accessEndedPosition: string | null;
	/** Bounded canonical messages. */
	readonly messages: readonly ConversationMessageDto[];
}

/** Generated run fields adopted by the browser adapter. */
export interface ConversationRunDto
{
	/** Opaque run coordinate. */
	readonly runId: string;
	/** Current attempt. */
	readonly attempt: number;
	/** Serialized lifecycle. */
	readonly state: string;
	/** Owning conversation coordinate. */
	readonly conversationId: string | null;
}
