import type { AgUiStreamState } from "@opencrane/state/conversation/ag-ui";

/** Browser connection phases for one authorized conversation event stream. */
export enum ConversationEventStreamStatuses
{
	/** The first cookie-authenticated request is being opened. */
	Connecting = "connecting",
	/** Incremental SSE bytes are currently being consumed. */
	Live = "live",
	/** A bounded server response ended or a transient request failed and will resume. */
	Reconnecting = "reconnecting",
	/** The caller aborted the stream. */
	Aborted = "aborted",
	/** The stream failed closed after its bounded retry allowance. */
	Failed = "failed",
}

/** One observable browser update from the incremental conversation stream. */
export interface ConversationEventStreamUpdate
{
	/** Current connection phase. */
	readonly status: ConversationEventStreamStatuses;
	/** Latest strictly reduced projection state. */
	readonly state: AgUiStreamState;
	/** Consecutive reconnect attempt, starting at zero for the initial connection. */
	readonly reconnectAttempt: number;
	/** Browser time of the latest server heartbeat. */
	readonly lastHeartbeatAt: number | null;
	/** Safe transport failure message, present only for terminal connection failure. */
	readonly error?: string;
}

/** Command for one long-lived cookie-authenticated event stream. */
export interface StreamConversationEventsCommand
{
	/** Opaque canonical conversation identifier. */
	readonly conversationId: string;
	/** Caller-owned cancellation signal. */
	readonly signal: AbortSignal;
	/** Prior reduced state. Its server-issued cursor is used exactly when reconnecting. */
	readonly initialState?: AgUiStreamState;
	/** Observer invoked after connection, heartbeat, reconnect, and reduced event changes. */
	readonly onUpdate?: (update: ConversationEventStreamUpdate) => void;
	/** Maximum consecutive request failures before the stream fails closed. */
	readonly maximumReconnectAttempts?: number;
	/** Delay between reconnect requests. */
	readonly reconnectDelayMilliseconds?: number;
}

/** Streams one signed-in participant's authorized conversation projection. */
export interface ConversationEventStream
{
	/**
	 * Stream snapshot and live-tail records until abort or terminal transport failure.
	 *
	 * @param command - Conversation, state, cancellation, and update coordinates.
	 * @returns The final safe state after caller abort.
	 */
	stream(command: StreamConversationEventsCommand): Promise<AgUiStreamState>;
}
