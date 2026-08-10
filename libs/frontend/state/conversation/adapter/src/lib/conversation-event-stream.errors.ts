/** Fail-closed error for malformed SSE framing or invalid AG-UI projection state. */
export class _ConversationEventProtocolError extends Error
{
	/** @param message - Safe protocol failure description. */
	public constructor(message: string, options?: ErrorOptions)
	{
		super(message, options);
		this.name = "ConversationEventProtocolError";
	}
}

/** HTTP response failure retaining the endpoint status for retry and authority decisions. */
export class _ConversationEventHttpError extends Error
{
	/** Exact HTTP status returned by the conversation event endpoint. */
	public readonly status: number;

	/** @param status - Exact endpoint response status. */
	public constructor(status: number)
	{
		super(status === 404 ? "conversation event access was revoked" : `conversation event endpoint returned HTTP ${status}`);
		this.name = "ConversationEventHttpError";
		this.status = status;
	}
}
