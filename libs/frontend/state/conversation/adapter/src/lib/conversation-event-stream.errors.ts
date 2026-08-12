/**
 * Thrown when the stream itself is wrong: bad SSE framing, or event data the reducer rejects.
 *
 * Do not reconnect on this. A retry hits the same bad data, so the stream is ended and the last
 * accepted state is surfaced instead.
 */
export class _ConversationEventProtocolError extends Error
{
	/** @param message - What was wrong with the frame or event; safe to show to the user. */
	public constructor(message: string, options?: ErrorOptions)
	{
		super(message, options);
		this.name = "ConversationEventProtocolError";
	}
}

/**
 * Thrown when the events endpoint returns a non-OK response, carrying the status.
 *
 * The status decides what happens next: 404 is treated as loss of access to the conversation, other
 * retryable statuses cause a reconnect, and anything else ends the stream.
 */
export class _ConversationEventHttpError extends Error
{
	/** The HTTP status returned; 404 means access was lost, not that the conversation is missing. */
	public readonly status: number;

	/** @param status - The HTTP status from the events endpoint. */
	public constructor(status: number)
	{
		super(status === 404 ? "conversation event access was revoked" : `conversation event endpoint returned HTTP ${status}`);
		this.name = "ConversationEventHttpError";
		this.status = status;
	}
}
