import type { AgentRunId, AgentServiceId, MessageId, SiloId, ThreadId, UserId } from "./identifiers.types.js";

/** Lifecycle state of a canonical conversation thread. */
export type ThreadState = "active" | "archived";

/** Author role of an immutable transcript message. */
export type MessageRole = "user" | "assistant" | "tool" | "system";

/** Lifecycle state of a transcript message while output is assembled. */
export type MessageState = "pending" | "streaming" | "completed" | "failed" | "cancelled";

/** Stable public vocabulary of ordered run events. */
export type RunEventType = "run.accepted" | "run.started" | "message.started" | "message.delta" | "message.completed" | "tool.requested" | "tool.approval_required" | "tool.started" | "tool.progress" | "tool.completed" | "context.compaction_started" | "context.compaction_completed" | "run.usage" | "run.completed" | "run.failed" | "run.cancelled";

/** Provenance attached to one immutable message. */
export interface MessageProvenance
{
	/** Run that authored the message, or null for direct user input. */
	readonly runId: AgentRunId | null;
	/** User who supplied the content, or null for runtime-authored content. */
	readonly userId: UserId | null;
	/** Stable source classification used by rendering and audit. */
	readonly source: "user_input" | "model_output" | "tool_result" | "platform";
}

/** Stable content block in an immutable transcript message. */
export interface MessageContentBlock
{
	/** Stable block identifier within the message. */
	readonly id: string;
	/** Content representation carried by the block. */
	readonly type: "text" | "artifact" | "tool_call" | "tool_result";
	/** Text content or immutable reference encoded for the selected block type. */
	readonly value: string;
}

/** Canonical user-visible conversation container. */
export interface Thread
{
	/** Stable thread identifier. */
	readonly id: ThreadId;
	/** Silo that owns the thread. */
	readonly siloId: SiloId;
	/** Agent service whose runs append to the thread. */
	readonly agentServiceId: AgentServiceId;
	/** Users explicitly participating in the thread. */
	readonly participantUserIds: readonly UserId[];
	/** Current lifecycle state. */
	readonly state: ThreadState;
	/** Current context-revision identifier, or null before compaction. */
	readonly contextRevisionId: string | null;
	/** ISO-8601 instant at which the thread was created. */
	readonly createdAt: string;
	/** ISO-8601 instant at which the thread was last changed. */
	readonly updatedAt: string;
}

/** Immutable canonical transcript record. */
export interface Message
{
	/** Stable message identifier. */
	readonly id: MessageId;
	/** Thread to which the message belongs. */
	readonly threadId: ThreadId;
	/** Author role shown in the transcript. */
	readonly role: MessageRole;
	/** Current assembly state. */
	readonly state: MessageState;
	/** Stable ordered content blocks. */
	readonly blocks: readonly MessageContentBlock[];
	/** Source provenance for audit and prompt compilation. */
	readonly provenance: MessageProvenance;
	/** ISO-8601 instant at which the message was created. */
	readonly createdAt: string;
	/** ISO-8601 completion instant, or null until terminal. */
	readonly completedAt: string | null;
}

/** Ordered immutable event emitted by one run. */
export interface RunEvent
{
	/** Run that owns the event stream. */
	readonly runId: AgentRunId;
	/** One-based contiguous sequence within the run. */
	readonly sequence: number;
	/** Stable public event classification. */
	readonly type: RunEventType;
	/** Immutable event payload with no runtime-SDK types. */
	readonly payload: Readonly<Record<string, unknown>>;
	/** ISO-8601 instant at which the event was persisted. */
	readonly occurredAt: string;
}
