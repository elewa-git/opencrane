/**
 * Which command the first-chat store is currently running, if any.
 *
 * Only one command runs at a time: while this is anything other than `Idle`, the store refuses new
 * commands rather than queueing them. The feature layer also reads it to pick the visible state —
 * `Entering` shows the loading screen, `Answering` disables the composer, `Concluding` shows the
 * finishing screen.
 *
 * @see PersonaFirstChatStore
 */
export enum PersonaFirstChatCommandPhases
{
	/** Nothing is running; a new command is allowed. */
	Idle = "idle",
	/** Route entry is running: reading state, and starting or concluding the chat if needed. */
	Entering = "entering",
	/** An answer is being sent. */
	Answering = "answering",
	/** The conclude call is in flight. */
	Concluding = "concluding"
}

/**
 * An answer the store is holding on to because sending it failed.
 *
 * Kept so Retry sends the identical answer, with the identical `idempotencyKey`, rather than a new
 * one — that is what stops a retry recording a second answer. Cleared once the server accepts it,
 * or once the server reports a conflict, because in both cases the answer is settled.
 *
 * @see PersonaFirstChatStore.retry
 */
export interface PersonaFirstChatPendingAnswer
{
	/** The conversation id this answer was written against. */
	readonly expectedConversationId: string;
	/** The question number this answer was written against. */
	readonly expectedQuestionOrdinal: number;
	/** The trimmed answer text, kept so a retry sends exactly the same thing. */
	readonly text: string;
	/** Retry key. Reused on every retry of this answer; a different answer gets a new one. */
	readonly idempotencyKey: string;
}
