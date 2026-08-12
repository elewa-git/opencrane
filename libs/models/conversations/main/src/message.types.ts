import type { ConversationId, MessageId } from "./identifiers.types.js";

/**
 * Who a message is shown as being from.
 *
 * This is a display role only. It proves nothing: a `user` message's real author is `userId`, and
 * an `assistant` message's is `runId`. Never authorize anything on the strength of a role.
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
 * How far a message's content has got.
 *
 * Only `Completed` means the content is final. `Pending` and `Streaming` are partial, and
 * `Failed` and `Cancelled` are partial forever — none of the three terminal states can resume.
 * A renderer must not treat a streaming message as finished.
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
 * What one block of a message's content is.
 *
 * The kind chooses how to render the block. An `Artifact` block holds a reference, not bytes, and
 * a reader must still pass the artifact's own access check before fetching it.
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
 * Which path a message came in through.
 *
 * Recorded for audit and rendering. It says how the message was admitted, not who wrote it, so it
 * must never be used to authenticate an author — `userId` and `runId` are the identity fields.
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

/** One stored message. `runId` and `userId` are the real identity fields, and `completedAt` is set exactly when `state` is terminal. */
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
	/** Caller-supplied key. Re-submitting the same key in the same conversation returns the existing message instead of creating a second one. */
	readonly idempotencyKey: string;
	/** ISO-8601 instant at which the message was created. */
	readonly createdAt: string;
	/** ISO-8601 completion instant, or null until terminal. */
	readonly completedAt: string | null;
}
