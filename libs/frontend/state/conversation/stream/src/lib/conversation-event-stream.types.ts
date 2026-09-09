import type { ConversationComputer, ConversationEntry } from "@opencrane/contracts";

/**
 * Reports how the browser's conversation-history connection should preserve or stop its state.
 *
 * Workspace state branches on these in-memory values. `Reconnecting` retains the last accepted
 * projection; `AccessChanged` requires its removal. `Aborted` and `Failed` stop the connection for
 * different reasons. Unknown values must not be treated as a live connection.
 */
export enum ConversationEventStreamStatuses
{
	/** The first authorized history read has not completed. */
	Connecting = "connecting",
	/** The authenticated event connection is open. */
	Live = "live",
	/** A temporary read failure is being retried without discarding accepted history. */
	Reconnecting = "reconnecting",
	/** The caller stopped the selected conversation connection. */
	Aborted = "aborted",
	/** Current access ended; the workspace must discard its selected history and draft. */
	AccessChanged = "access_changed",
	/** Transport retries ended or history could not be validated; participant action is required. */
	Failed = "failed",
}

/** Holds the exact participant-visible history accepted from the server. */
export interface ConversationHistoryProjection
{
	/** Immutable entries in canonical stream-position order. */
	readonly entries: readonly ConversationEntry[];
	/** Resolved private text indexed by the payload reference carried in message entries. */
	readonly payloads: Readonly<Record<string, string>>;
	/** Last accepted decimal stream position, used as the exclusive next-read cursor. */
	readonly nextPosition: string;
	/** Current logical computer projection, or null for conversations without a computer. */
	readonly computer: ConversationComputer | null;
}

/** Carries one connection lifecycle update with the last fully accepted projection. */
export interface ConversationEventStreamUpdate
{
	/** Current connection phase. */
	readonly status: ConversationEventStreamStatuses;
	/** Last fully validated history projection. */
	readonly state: ConversationHistoryProjection;
	/** Consecutive transport failures since accepted progress or a healthy server close. */
	readonly reconnectAttempt: number;
	/** Browser time of the latest authenticated connection, history event, or heartbeat. */
	readonly lastHeartbeatAt: number | null;
	/** Fixed display-safe failure message set only for a terminal failure. */
	readonly error?: string;
}

/** Supplies one selected conversation and its bounded connection lifecycle. */
export interface StreamConversationEventsCommand
{
	/** Opaque conversation identifier authorized by the server session. */
	readonly conversationId: string;
	/** Stops the connection when selection or page lifetime changes. */
	readonly signal: AbortSignal;
	/** Previously accepted state whose next position resumes history and event reads. */
	readonly initialState?: ConversationHistoryProjection;
	/** Receives every successful read and lifecycle change. */
	readonly onUpdate?: (update: ConversationEventStreamUpdate) => void;
	/** Consecutive failures allowed before reconnecting stops. */
	readonly maximumReconnectAttempts?: number;
	/** Initial retry delay; the adapter may apply backoff and a server-requested minimum. */
	readonly reconnectDelayMilliseconds?: number;
}

/**
 * Follows authorized history without prescribing the browser transport.
 *
 * The implementation preserves the last fully validated projection across transient failures and
 * stops when the caller aborts, access ends, or recovery requires participant action. This port grants no conversation access;
 * the production adapter uses the signed-in HTTP context supplied by its own boundary.
 *
 * Called by: `ConversationWorkspaceStore` through `CONVERSATION_WORKSPACE_EVENT_STREAM`.
 */
export interface ConversationEventStream
{
	/**
	 * Follows history until aborted or failed and reports each accepted projection through `onUpdate`.
	 * @param command - Selects the conversation, prior cursor, abort signal, and retry policy.
	 * @returns The last accepted projection on abort, or an empty projection after access ends.
	 * @throws {Error} When transport retries end or an invalid response requires explicit recovery.
	 */
	stream(command: StreamConversationEventsCommand): Promise<ConversationHistoryProjection>;
}

/**
 * Builds the empty projection used before the first authorized history read.
 * Called by: `ConversationWorkspaceStore`, `OpenCraneConversationEventStream`, and their focused tests.
 * @returns A fresh projection at cursor zero with no entries, payloads, or computer.
 */
export function __CreateConversationHistoryProjection(): ConversationHistoryProjection
{
	return { entries: [], payloads: {}, nextPosition: "0", computer: null };
}
