import type { RunEvent, RunEventType } from "@opencrane/models/agents";

/** Atomic append request bound to the caller's observed event sequence. */
export interface AppendRunEventCommand
{
	/** Run receiving the immutable event. */
	readonly runId: string;
	/** One-based sequence expected by the caller. */
	readonly sequence: number;
	/** Canonical public event type. */
	readonly type: RunEventType;
	/** Runtime-neutral event payload. */
	readonly payload: Readonly<Record<string, unknown>>;
	/** Canonical event timestamp. */
	readonly occurredAt: string;
}

/** Persistence result from one serialized event append. */
export type AtomicAppendRunEventResult =
	| { readonly status: "appended"; readonly event: RunEvent }
	| { readonly status: "sequence_conflict"; readonly nextSequence: number }
	| { readonly status: "terminal" }
	| { readonly status: "run_not_found" };

/** Persistence boundary that owns event-stream fencing and replay serialization. */
export interface ConversationAuthorityRepository
{
	/** Appends only when the run exists, is non-terminal, and sequence is exactly next. */
	appendRunEventAtomically(command: AppendRunEventCommand): Promise<AtomicAppendRunEventResult>;
}

/** One atomic request to persist a user message and every immutable artifact input it introduces. */
export interface SubmitConversationUserInputCommand
{
	/** Server-generated message coordinate used for one idempotent transport attempt. */
	readonly messageId: string;
	/** Silo containing the exact conversation and every artifact revision. */
	readonly siloId: string;
	/** Active conversation thread receiving the input. */
	readonly threadId: string;
	/** User who participates in the thread and owns each submitted artifact. */
	readonly userId: string;
	/** Optional literal user text; attachment-only inputs use an empty string. */
	readonly text: string;
	/** Ordered immutable revisions attached to this exact message. */
	readonly artifactRevisionIds: readonly string[];
}

/** Raw result from the transaction that writes the completed message and its inputs together. */
export type AtomicSubmitConversationUserInputResult = { readonly status: "submitted" } | { readonly status: "thread_unavailable" | "artifact_unavailable" | "conflict" | "persistence_unavailable" };

/** Persistence boundary that keeps a user message and its artifact inputs inseparable. */
export interface ConversationUserInputRepository
{
	/** Creates and completes one exact user-input message with all validated attachments in one transaction. */
	submitAtomically(command: SubmitConversationUserInputCommand): Promise<AtomicSubmitConversationUserInputResult>;
}

/** Stable outcome exposed to conversation use cases. */
export type AppendRunEventResult =
	| { readonly outcome: "appended"; readonly event: RunEvent }
	| { readonly outcome: "denied"; readonly reason: "invalid_command" | "sequence_conflict" | "terminal" | "run_not_found"; readonly nextSequence?: number };

/** Stable result exposed when a user submits text and multimodal input to a conversation. */
export type SubmitConversationUserInputResult = { readonly outcome: "submitted" } | { readonly outcome: "denied"; readonly reason: "invalid_command" | "thread_unavailable" | "artifact_unavailable" | "conflict" | "persistence_unavailable" };
