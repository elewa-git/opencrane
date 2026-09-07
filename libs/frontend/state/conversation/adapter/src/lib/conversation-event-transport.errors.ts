import { ConversationTransportFailureKinds } from "./conversation-event-transport.types";

/** Carries a display-safe transport decision without retaining raw server error bodies. */
export class ConversationTransportError extends Error
{
	/** Selects purge, explicit recovery, or a bounded reconnect. */
	public readonly kind: ConversationTransportFailureKinds;
	/** Sets the minimum retry delay requested by the server. */
	public readonly retryAfterMilliseconds: number;

	/** Records the transport decision and exposes fixed copy only. */
	public constructor(kind: ConversationTransportFailureKinds, retryAfterMilliseconds = 0)
	{
		super("Conversation history is unavailable.");
		this.kind = kind;
		this.retryAfterMilliseconds = retryAfterMilliseconds;
	}
}

/** Maps HTTP authority and rate-limit responses without displaying their response bodies. */
export function _ConversationResponseError(response: Response): ConversationTransportError
{
	if ([401, 403, 404].includes(response.status))
		return new ConversationTransportError(ConversationTransportFailureKinds.AccessChanged);
	if (response.status === 429)
	{
		const retryAfter = response.headers.get("Retry-After") ?? "60";
		const milliseconds = /^\d+$/u.test(retryAfter) ? Number(retryAfter) * 1_000 : Date.parse(retryAfter) - Date.now();
		if (!Number.isFinite(milliseconds) || milliseconds > 300_000)
			return new ConversationTransportError(ConversationTransportFailureKinds.InvalidResponse);
		return new ConversationTransportError(ConversationTransportFailureKinds.Retryable, Math.max(0, milliseconds));
	}
	const kind = response.status >= 500 ? ConversationTransportFailureKinds.Retryable : ConversationTransportFailureKinds.InvalidResponse;
	return new ConversationTransportError(kind);
}
