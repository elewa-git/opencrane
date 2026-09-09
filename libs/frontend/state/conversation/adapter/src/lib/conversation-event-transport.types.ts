/**
 * Identifies the server event selected by the conversation SSE endpoint.
 * These wire values grant no access and are not persisted by the browser; unknown events fail closed.
 */
export enum ConversationServerEvents
{
	/** Carries an authorized history page and its exclusive next-read checkpoint. */
	History = "history",
	/** Ends this connection after authority or history validation fails. */
	Unavailable = "unavailable",
}

/** Identifies the fixed terminal errors returned by the server's unavailable event. */
export enum ConversationServerErrors
{
	/** Current participant authority ended; discard the selected private projection. */
	AccessChanged = "conversation_unavailable",
	/** History could not be safely produced; retain accepted data for explicit recovery. */
	HistoryUnavailable = "conversation_history_unavailable",
}

/** Contains one decoded SSE frame; a comment-only frame has no event and signals a heartbeat. */
export interface ConversationServerFrame
{
	/** Selects the history or terminal-error body, or is absent for a heartbeat. */
	readonly event?: ConversationServerEvents;
	/** Supplies the accepted history cursor; terminal errors do not carry one. */
	readonly id?: string;
	/** Contains joined data lines, before JSON or domain validation. */
	readonly data: string;
}

/** Distinguishes retryable transport loss from responses that must stop the selected stream. */
export enum ConversationTransportFailureKinds
{
	/** The participant must no longer retain this conversation's private data. */
	AccessChanged = "access_changed",
	/** Retrying the same response would repeat an integrity or protocol failure. */
	InvalidResponse = "invalid_response",
	/** A connection failure may be retried within the selected stream's retry allowance. */
	Retryable = "retryable",
}
