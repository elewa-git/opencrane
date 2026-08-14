import { InjectionToken } from "@angular/core";
import { UserOnboardingRouteStates, type PersonaFirstChatSnapshot } from "@opencrane/models/user-onboarding";

/**
 * Where the user is in onboarding, cheap enough to read on every navigation.
 *
 * Unlike {@link PersonaFirstChatSnapshot} this starts nothing and contains no transcript — it exists
 * so routing decisions come from the server's state rather than from anything the UI remembers.
 *
 * @see UserOnboardingRouteStates
 */
export interface UserOnboardingRouteSnapshot
{
	/** Version of the onboarding workflow definition this user's record was created under. */
	readonly workflowVersion: number;
	/** Which onboarding step the user is on. This is the field routing decisions are made from. */
	readonly state: UserOnboardingRouteStates;
	/** The persona interview attached to this user's survey, or null before one is started. */
	readonly personaInterviewId: string | null;
	/** The approved persona revision, or null until the survey has been approved. */
	readonly personaRevisionId: string | null;
	/** The user's one onboarding conversation, or null until it has been started. */
	readonly bootstrapConversationId: string | null;
	/** When the onboarding record was created, as an ISO 8601 timestamp with an offset. Always set. */
	readonly startedAt: string;
	/** When the server last changed this record, as an ISO 8601 timestamp with an offset. */
	readonly updatedAt: string;
	/** When the server accepted onboarding as finished, or null while it is unfinished. */
	readonly completedAt: string | null;
}

/**
 * One answer, addressed to the exact conversation and question it was written for.
 *
 * The two `expected*` fields let the server refuse an answer aimed at a question it has already
 * moved past, rather than silently recording it against the wrong one. `idempotencyKey` must stay
 * the same across retries of the same answer and change for a new one.
 *
 * @see PersonaFirstChatGateway.answer
 */
export interface PersonaFirstChatAnswerCommand
{
	/** The conversation id from the snapshot this answer was written against. */
	readonly expectedConversationId: string;
	/** The question number, from 1, that the snapshot said was current when the user answered. The
	 *  server compares it with its own and refuses the answer if the chat has since moved on. */
	readonly expectedQuestionOrdinal: number;
	/** What the user typed, sent unchanged. The server trims and length-checks it, so do not do either
	 *  here — the text the server accepts is the text that appears in the transcript. */
	readonly text: string;
	/** Retry key for this answer. Keep it the same when retrying; change it only for a new answer. */
	readonly idempotencyKey: string;
}

/**
 * Thrown when an answer is sent for a question the conversation has already moved past.
 *
 * This is recoverable, not a failure. It happens when the same chat advanced elsewhere — another
 * tab, or a retry after a response was lost. The current chat is attached as {@link chat}: adopt it,
 * clear the pending answer, and show the user the question the server is actually on. Do not retry
 * the same answer.
 *
 * Thrown by: OpenCranePersonaFirstChatGateway.answer. Handled by PersonaFirstChatStore._submit.
 *
 * @see PersonaFirstChatSnapshot
 */
export class PersonaFirstChatConflictError extends Error
{
	/** The chat as the server currently sees it — adopt this instead of retrying. */
	readonly chat: PersonaFirstChatSnapshot;

	/** @param chat - The server's current chat, kept so the UI can recover without seeing transport details. */
	constructor(chat: PersonaFirstChatSnapshot)
	{
		super("The saved conversation advanced elsewhere. Review the current question before sending again.");
		this.chat = chat;
	}
}

/**
 * The five first-chat calls, wrapped so the rest of the frontend never touches the generated client.
 *
 * Every method returns the server's whole {@link PersonaFirstChatSnapshot}, so a caller replaces its
 * state with the result rather than patching it. Nothing here is optimistic: the server decides what
 * the next question is and whether the chat can finish.
 *
 * Bound to OpenCranePersonaFirstChatGateway in apps/opencrane-ui/src/app/app.config.ts via
 * {@link PERSONA_FIRST_CHAT_GATEWAY}. Mock it at that token in tests.
 *
 * @see PersonaFirstChatService
 */
export interface PersonaFirstChatGateway
{
	/**
	 * Reads which onboarding step the user is on, without starting or changing anything.
	 *
	 * Safe to call before the chat exists — this is how a route guard decides where to send someone.
	 *
	 * Called by: PersonaFirstChatService.loadRouteState, used by PersonaOnboardingStore after the
	 * persona is approved.
	 *
	 * @returns The current route state. Never creates a conversation.
	 */
	loadRouteState(): Promise<UserOnboardingRouteSnapshot>;
	/**
	 * Reads the current first chat without changing it.
	 *
	 * Called by: PersonaFirstChatService.load, which backs the store's `chat` resource.
	 *
	 * @returns The chat as it stands. Before the chat has started, `conversationId`, `persona` and
	 *   `contentRevision` are all null.
	 */
	load(): Promise<PersonaFirstChatSnapshot>;
	/**
	 * Starts the one onboarding conversation, or returns the existing one.
	 *
	 * Safe to call twice: the user gets one onboarding conversation and no more, so a repeat resumes
	 * rather than creating a second.
	 *
	 * Called by: PersonaFirstChatService.start, from PersonaFirstChatStore.enter when the route state
	 * is BootstrapChatPending.
	 *
	 * @returns The chat with its conversation, persona and content source now filled in.
	 */
	start(): Promise<PersonaFirstChatSnapshot>;
	/**
	 * Sends one answer.
	 *
	 * Reuse the same `idempotencyKey` when retrying the same answer; the server will not record it
	 * twice. Change the key only for a genuinely new answer.
	 *
	 * Called by: PersonaFirstChatService.answer, from PersonaFirstChatStore._submit.
	 *
	 * @param command - The conversation and question the answer is for, the text, and the retry key.
	 * @returns The chat after the answer, with `currentQuestion` moved on and `answerCount` raised.
	 * @throws PersonaFirstChatConflictError when the conversation has already moved past that
	 *   question. The error carries the current chat — adopt it and show the user the real question
	 *   rather than retrying.
	 */
	answer(command: PersonaFirstChatAnswerCommand): Promise<PersonaFirstChatSnapshot>;
	/**
	 * Asks the server to finish onboarding.
	 *
	 * Only call this when the chat's `canConclude` is true; the server checks again and refuses
	 * otherwise. Safe to retry — concluding twice does not double-finish.
	 *
	 * Called by: PersonaFirstChatService.conclude, from PersonaFirstChatStore.enter and ._submit.
	 *
	 * @returns The finished chat, with `state` Completed and `completedAt` set.
	 */
	conclude(): Promise<PersonaFirstChatSnapshot>;
}

/**
 * The injection token every first-chat caller depends on, instead of depending on a concrete adapter.
 *
 * There is a token rather than a class here so the HTTP adapter can be swapped without touching the
 * services or stores above it. In the running application it is bound to
 * OpenCranePersonaFirstChatGateway in `apps/opencrane-ui/src/app/app.config.ts`; in a test, provide a
 * stub at this token and no network call happens.
 *
 * Injected by: PersonaFirstChatService, which is the only thing that should read it — stores and
 * components go through that service.
 *
 * @see PersonaFirstChatGateway for the five calls a binding must implement.
 */
export const PERSONA_FIRST_CHAT_GATEWAY: InjectionToken<PersonaFirstChatGateway> = new InjectionToken<PersonaFirstChatGateway>("PERSONA_FIRST_CHAT_GATEWAY");
