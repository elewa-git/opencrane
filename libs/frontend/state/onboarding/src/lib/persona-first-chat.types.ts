import { InjectionToken } from "@angular/core";

/**
 * Which onboarding step the user is on. The server owns this; the UI only reads it to route.
 *
 * The order is fixed: survey → bootstrap chat → completed. `SurveyPending` and `SurveyInProgress`
 * both mean the persona interview is unfinished, so both route to the persona page.
 * `BootstrapChatPending` means start the chat; `BootstrapChatInProgress` means resume it. Only
 * `Completed` may reach the workspace.
 *
 * Never advance this locally — a UI that guesses the next stage will disagree with the server on
 * reconnect.
 */
export enum UserOnboardingRouteStates
{
	/** The reviewed persona interview has not started. */
	SurveyPending = "survey_pending",
	/** The persona interview has started but is not finished. */
	SurveyInProgress = "survey_in_progress",
	/** An approved persona is ready for its one-time bootstrap exchange. */
	BootstrapChatPending = "bootstrap_chat_pending",
	/** The first chat has started; reload the page and it picks up where it left off. */
	BootstrapChatInProgress = "bootstrap_chat_in_progress",
	/** The server checked all the answers and marked onboarding finished. */
	Completed = "completed"
}

/**
 * The four approved persona archetypes. Each one picks a different set of first-chat questions.
 *
 * Comes from the approved persona revision, so the UI reads it and never chooses it.
 */
export enum PersonaFirstChatArchetypes
{
	/** Direct and decisive first-chat pacing. */
	Commander = "commander",
	/** Energetic and collaborative first-chat pacing. */
	Catalyst = "catalyst",
	/** Calm and supportive first-chat pacing. */
	Anchor = "anchor",
	/** Precise and structured first-chat pacing. */
	Analyst = "analyst"
}

/**
 * The persona's colour, as recorded on the approved revision.
 *
 * Maps to a display tone in the feature layer; it is not a CSS value.
 */
export enum PersonaFirstChatColours
{
	/** Commander's colour. */
	Red = "red",
	/** Catalyst colour coordinate. */
	Yellow = "yellow",
	/** Anchor colour coordinate. */
	Green = "green",
	/** Analyst colour coordinate. */
	Blue = "blue"
}

/** Who said a transcript entry: the assistant or the user. */
export enum PersonaFirstChatTranscriptRoles
{
	/** Reviewed opening or question material. */
	Assistant = "assistant",
	/** Something the user answered. */
	User = "user"
}

/** What a transcript entry is: the opening message, a question, or an answer. */
export enum PersonaFirstChatTranscriptKinds
{
	/** One-time reviewed introduction. */
	Opening = "opening",
	/** One of the exact three reviewed calibration questions. */
	Question = "question",
	/** One admitted owner answer. */
	Answer = "answer"
}

/** The approved persona this chat is running as. */
export interface PersonaFirstChatPersona
{
	/** Immutable approved persona revision identifier. */
	readonly revisionId: string;
	/** Reviewed human-readable persona name. */
	readonly displayName: string;
	/** Reviewed bootstrap archetype selected from the persona revision. */
	readonly archetype: PersonaFirstChatArchetypes;
	/** Exact primary colour carried by the approved persona revision. */
	readonly primaryColour: PersonaFirstChatColours;
}

/** Which version of the question text this conversation is using. It never changes mid-chat. */
export interface PersonaFirstChatContentRevision
{
	/** Stable source revision identifier. */
	readonly id: string;
	/** SHA-256 of the approved question text, so a change to it can be detected. */
	readonly digest: string;
	/** Human-readable reviewed source label. */
	readonly sourceLabel: string;
}

/** One line of the conversation, as the server recorded it. */
export interface PersonaFirstChatTranscriptEntry
{
	/** Position in the transcript, starting at 1 with no gaps. Not an id — do not use it as a key. */
	readonly ordinal: number;
	/** Speaker role selecting safe presentation alignment. */
	readonly role: PersonaFirstChatTranscriptRoles;
	/** Whether this entry is the opening, a question, or an answer. */
	readonly kind: PersonaFirstChatTranscriptKinds;
	/** Plain bounded text rendered without HTML interpretation. */
	readonly text: string;
	/** Which question this entry belongs to (1, 2 or 3), or null if it is the opening. */
	readonly questionOrdinal: number | null;
}

/** The question to ask next, which the server picks from how many answers it has saved. */
export interface PersonaFirstChatCurrentQuestion
{
	/** Which of the three questions this is: 1, 2 or 3. */
	readonly ordinal: number;
	/** Reviewed question text. */
	readonly text: string;
}

/**
 * The whole state of a user's first chat, as the server sees it.
 *
 * Every gateway call returns one of these, so treat it as a replacement for whatever the UI held
 * before rather than something to merge. It is designed to be resumable: from this alone the UI can
 * work out whether the chat has started, which question is next, and whether it can be finished —
 * no local progress tracking is needed, or allowed.
 *
 * Before the chat starts, `conversationId`, `persona` and `contentRevision` are null and the
 * transcript is empty. After the last answer, `currentQuestion` is null and `canConclude` is true.
 *
 * @see PersonaFirstChatGateway
 * @see UserOnboardingRouteStates
 */
export interface PersonaFirstChatSnapshot
{
	/** Workflow definition version pinned to the owner record. */
	readonly workflowVersion: number;
	/** Current durable onboarding route state. */
	readonly state: UserOnboardingRouteStates;
	/** One onboarding-only conversation identifier, once started. */
	readonly conversationId: string | null;
	/** The approved persona, or null before the chat has started. */
	readonly persona: PersonaFirstChatPersona | null;
	/** Which approved question set this chat is pinned to, or null before it has started. */
	readonly contentRevision: PersonaFirstChatContentRevision | null;
	/** The whole conversation so far, already in display order — do not re-sort it. */
	readonly transcript: readonly PersonaFirstChatTranscriptEntry[];
	/** Next reviewed question, or null before start and after all answers. */
	readonly currentQuestion: PersonaFirstChatCurrentQuestion | null;
	/** How many answers the server has saved. */
	readonly answerCount: number;
	/** Number of reviewed questions pinned to this exchange. */
	readonly questionCount: number;
	/** Whether every answer is in and the chat can now be concluded. */
	readonly canConclude: boolean;
	/** Server timestamp for the started conversation, or null before start. */
	readonly startedAt: string | null;
	/** Server timestamp for validated workflow completion, or null while unfinished. */
	readonly completedAt: string | null;
}

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
	/** Workflow definition version pinned to the owner record. */
	readonly workflowVersion: number;
	/** Current durable onboarding route state. */
	readonly state: UserOnboardingRouteStates;
	/** Exact persona interview pinned to the survey, when present. */
	readonly personaInterviewId: string | null;
	/** Exact approved persona revision pinned to onboarding, when present. */
	readonly personaRevisionId: string | null;
	/** Exact onboarding-only conversation, once started. */
	readonly bootstrapConversationId: string | null;
	/** Server timestamp for workflow creation. */
	readonly startedAt: string;
	/** Server timestamp for the last durable workflow change. */
	readonly updatedAt: string;
	/** Server timestamp for validated completion, or null while unfinished. */
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
	/** One-based question ordinal returned by the authoritative projection. */
	readonly expectedQuestionOrdinal: number;
	/** What the user typed, kept exactly as-is until the server accepts it. */
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

/** Dependency-injection token for the active first-chat API adapter. */
export const PERSONA_FIRST_CHAT_GATEWAY: InjectionToken<PersonaFirstChatGateway> = new InjectionToken<PersonaFirstChatGateway>("PERSONA_FIRST_CHAT_GATEWAY");
