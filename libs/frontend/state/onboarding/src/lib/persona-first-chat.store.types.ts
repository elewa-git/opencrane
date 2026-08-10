/** Finite route-instance commands that own first-chat transport admission. */
export enum PersonaFirstChatCommandPhases
{
	/** No first-chat command currently owns admission. */
	Idle = "idle",
	/** The route is reading, starting, or resuming its authoritative conversation. */
	Entering = "entering",
	/** One exact answer intent is being admitted. */
	Answering = "answering",
	/** Server-validated completion is being requested. */
	Concluding = "concluding"
}

/** Retry-stable coordinates for one owner answer awaiting authoritative admission. */
export interface PersonaFirstChatPendingAnswer
{
	/** Exact conversation returned by the latest authoritative projection. */
	readonly expectedConversationId: string;
	/** Exact one-based question coordinate returned by the server. */
	readonly expectedQuestionOrdinal: number;
	/** Normalised non-empty owner answer retained across transport failure. */
	readonly text: string;
	/** Conversation-local key reused only for this exact answer intent. */
	readonly idempotencyKey: string;
}
