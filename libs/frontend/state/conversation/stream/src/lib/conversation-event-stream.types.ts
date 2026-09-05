import type { ConversationComputer, ConversationEntry } from "@opencrane/contracts";

/** Reports the lifecycle of the browser's bounded conversation-history poller. */
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

/** Reads one signed-in participant's finite Kurrent-backed history ranges. */
export interface ConversationEventStream
{
	/** Poll until aborted, preserving the latest fully validated history projection. */
	stream(command: StreamConversationEventsCommand): Promise<ConversationHistoryProjection>;
}

/** Builds the empty projection used before the first authorized history read. */
export function __CreateConversationHistoryProjection(): ConversationHistoryProjection
{
	return { entries: [], payloads: {}, nextPosition: "0", computer: null };
}
