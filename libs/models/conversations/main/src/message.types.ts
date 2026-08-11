import type { ConversationId, MessageId } from "./identifiers.types.js";

/**
 * Stable author roles for canonical conversation messages.
 *
 * Values are persisted and rendered, but do not prove the author's identity or authority.
 */
export enum MessageRoles
{
	/** Participant-authored input with a separately bound user identifier. */
	User = "user",
	/** Agent-runtime output with a separately bound run identifier. */
	Assistant = "assistant",
	/** Governed tool result projected into the conversation. */
	Tool = "tool",
	/** Platform-authored information that does not impersonate a participant. */
	System = "system",
}

/**
 * Stable assembly lifecycle for a canonical conversation message.
 *
 * Values are persisted so replay never mistakes partial output for completed content.
 */
export enum MessageStates
{
	/** The message exists but content assembly has not started. */
	Pending = "pending",
	/** Content is being appended by its owning admission path. */
	Streaming = "streaming",
	/** Content assembly finished successfully and cannot resume. */
	Completed = "completed",
	/** Content assembly failed and cannot resume. */
	Failed = "failed",
	/** Content assembly was cancelled and cannot resume. */
	Cancelled = "cancelled",
}

/**
 * Stable content-block representations inside one canonical message.
 *
 * These values select rendering only; referenced assets and tools retain their own authority.
 */
export enum MessageContentBlockKinds
{
	/** Plain textual content. */
	Text = "text",
	/** Immutable artifact reference rendered through separate access checks. */
	Artifact = "artifact",
	/** Sanitized tool-call representation. */
	ToolCall = "tool_call",
	/** Sanitized tool-result representation. */
	ToolResult = "tool_result",
}

/**
 * Stable provenance sources recorded on every canonical message.
 *
 * Values distinguish admission paths for audit and rendering but do not authenticate an author.
 */
export enum MessageSources
{
	/** Ordinary or run-admitted participant input. */
	UserInput = "user_input",
	/** Output created by one admitted agent run. */
	ModelOutput = "model_output",
	/** Sanitized result of one governed tool action. */
	ToolResult = "tool_result",
	/** Platform-authored lifecycle or informational content. */
	Platform = "platform",
}

/** Stable content block in an immutable transcript message. */
export interface MessageContentBlock
{
	/** Stable block identifier within the message. */
	readonly id: string;
	/** Content representation carried by the block. */
	readonly kind: MessageContentBlockKinds;
	/** Text content or immutable reference encoded for the selected block kind. */
	readonly value: string;
}

/** Canonical durable conversation message admitted by exactly one mode strategy. */
export interface Message
{
	/** Stable message identifier. */
	readonly id: MessageId;
	/** Conversation to which the message belongs. */
	readonly conversationId: ConversationId;
	/** Author role shown in the transcript. */
	readonly role: MessageRoles;
	/** Current assembly state. */
	readonly state: MessageStates;
	/** Stable provenance classification for audit and rendering. */
	readonly source: MessageSources;
	/** Stable ordered content blocks. */
	readonly blocks: readonly MessageContentBlock[];
	/** Run that authored or admitted the message, or null for ordinary direct and group messages. */
	readonly runId: string | null;
	/** User who authored the message, or null for runtime- and platform-authored content. */
	readonly userId: string | null;
	/** Durable caller key that makes message admission idempotent within the conversation. */
	readonly idempotencyKey: string;
	/** ISO-8601 instant at which the message was created. */
	readonly createdAt: string;
	/** ISO-8601 completion instant, or null until terminal. */
	readonly completedAt: string | null;
}
