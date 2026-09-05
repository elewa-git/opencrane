import type { ConversationComputer, ConversationEntry } from "@opencrane/contracts";

/**
 * Reports how the browser's finite conversation-history poller should preserve or stop its state.
 *
 * Workspace state branches on these in-memory values. `Reconnecting` retains the last accepted
 * projection, while `Aborted` and `Failed` stop polling for different reasons; unknown values must
 * not be treated as a live connection.
 */
export enum ConversationEventStreamStatuses
{
	/** The first authorized history read has not completed. */
	Connecting = "connecting",
	/** The latest authorized history read completed and another poll is scheduled. */
	Live = "live",
	/** A temporary read failure is being retried without discarding accepted history. */
	Reconnecting = "reconnecting",
	/** The caller stopped the selected conversation poller. */
	Aborted = "aborted",
	/** The bounded retry allowance ended and participant action is required. */
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

/** Carries one poller lifecycle update with the last fully accepted projection. */
export interface ConversationEventStreamUpdate
{
	/** Current polling phase. */
	readonly status: ConversationEventStreamStatuses;
	/** Last fully validated history projection. */
	readonly state: ConversationHistoryProjection;
	/** Consecutive failed reads since the latest successful read. */
	readonly reconnectAttempt: number;
	/** Browser time of the latest successful history response. */
	readonly lastHeartbeatAt: number | null;
	/** Fixed display-safe failure message set only for a terminal failure. */
	readonly error?: string;
}

/** Supplies one selected conversation and its bounded polling lifecycle. */
export interface StreamConversationEventsCommand
{
	/** Opaque conversation identifier authorized by the server session. */
	readonly conversationId: string;
	/** Stops polling when selection or page lifetime changes. */
	readonly signal: AbortSignal;
	/** Previously accepted state whose next position resumes the finite history read. */
	readonly initialState?: ConversationHistoryProjection;
	/** Receives every successful read and lifecycle change. */
	readonly onUpdate?: (update: ConversationEventStreamUpdate) => void;
	/** Consecutive failures allowed before polling stops. */
	readonly maximumReconnectAttempts?: number;
	/** Delay between successful finite reads. */
	readonly pollDelayMilliseconds?: number;
	/** Delay before retrying a failed finite read. */
	readonly reconnectDelayMilliseconds?: number;
}

/**
 * Polls finite, authorized history ranges without prescribing the browser transport.
 *
 * The implementation preserves the last fully validated projection across transient failures and
 * stops when the caller aborts or the retry allowance ends. This port grants no conversation access;
 * the production adapter uses the signed-in HTTP context supplied by its own boundary.
 *
 * Called by: `ConversationWorkspaceStore` through `CONVERSATION_WORKSPACE_EVENT_STREAM`.
 */
export interface ConversationEventStream
{
	/**
	 * Polls until aborted or failed and reports each accepted projection through `onUpdate`.
	 * @param command - Selects the conversation, prior cursor, abort signal, and retry policy.
	 * @returns The last fully validated projection when the caller aborts.
	 * @throws {Error} When the retry allowance ends before another authorized read succeeds.
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
