/**
 * Says which onboarding screen the user may enter.
 *
 * The onboarding authority sends these string values in route and first-chat responses. Frontend
 * routing reads them but must never advance them locally: reconnecting must return to the step the
 * server actually saved. The values cross the API boundary, so renaming one is a breaking change.
 * Runtime validators reject unknown values before they reach browser state.
 */
export enum UserOnboardingRouteStates
{
	/** The reviewed persona interview has not started. */
	SurveyPending = "survey_pending",
	/** The persona interview has started but is not finished. */
	SurveyInProgress = "survey_in_progress",
	/** An approved persona is ready for its one-time bootstrap exchange. */
	BootstrapChatPending = "bootstrap_chat_pending",
	/** The first chat has started and can be resumed. */
	BootstrapChatInProgress = "bootstrap_chat_in_progress",
	/** The server checked all answers and marked onboarding finished. */
	Completed = "completed"
}

/**
 * Selects the reviewed tone and question set for the first chat.
 *
 * The approved persona revision supplies this value and frontend presentation reads it; neither
 * layer may choose a different archetype. These strings cross the API boundary, and the runtime
 * parser rejects values outside this closed set.
 */
export enum PersonaFirstChatArchetypes
{
	/** Direct and decisive pacing. */
	Commander = "commander",
	/** Energetic and collaborative pacing. */
	Catalyst = "catalyst",
	/** Calm and supportive pacing. */
	Anchor = "anchor",
	/** Precise and structured pacing. */
	Analyst = "analyst"
}

/**
 * Selects the approved display tone for the first-chat persona.
 *
 * The value comes from the approved persona revision and maps to a frontend tone rather than a CSS
 * colour. It crosses the API boundary as a string, so changing a value breaks saved responses;
 * runtime parsing rejects unknown values.
 */
export enum PersonaFirstChatColours
{
	/** Commander colour. */
	Red = "red",
	/** Catalyst colour. */
	Yellow = "yellow",
	/** Anchor colour. */
	Green = "green",
	/** Analyst colour. */
	Blue = "blue"
}

/**
 * Says whether the assistant or the account owner spoke one first-chat transcript line.
 *
 * The onboarding authority sends this string in every transcript entry and the workspace mapper
 * uses it for safe presentation alignment. Runtime parsing rejects any other role.
 */
export enum PersonaFirstChatTranscriptRoles
{
	/** Reviewed opening or question material. */
	Assistant = "assistant",
	/** One admitted owner answer. */
	User = "user"
}

/**
 * Says whether a first-chat transcript line is the opening, a reviewed question, or an answer.
 *
 * The onboarding authority sends this string and the validator checks it against the line's role,
 * question number, and saved answer count. Unknown values are rejected before feature code reads
 * them.
 */
export enum PersonaFirstChatTranscriptKinds
{
	/** One-time reviewed introduction. */
	Opening = "opening",
	/** One reviewed calibration question. */
	Question = "question",
	/** One admitted owner answer. */
	Answer = "answer"
}

/** Approved persona evidence frozen into the first-chat projection. */
export interface PersonaFirstChatPersona
{
	/** Immutable approved persona revision. */
	readonly revisionId: string;
	/** Reviewed owner-visible persona name. */
	readonly displayName: string;
	/** Reviewed bootstrap archetype. */
	readonly archetype: PersonaFirstChatArchetypes;
	/** Approved display colour. */
	readonly primaryColour: PersonaFirstChatColours;
}

/** Immutable reviewed question-set identity. */
export interface PersonaFirstChatContentRevision
{
	/** Stable source revision. */
	readonly id: string;
	/** SHA-256 digest of the approved question text. */
	readonly digest: string;
	/** Human-readable reviewed source label. */
	readonly sourceLabel: string;
}

/** One server-ordered line of the onboarding exchange. */
export interface PersonaFirstChatTranscriptEntry
{
	/** One-based contiguous transcript order. */
	readonly ordinal: number;
	/** Stable speaker role. */
	readonly role: PersonaFirstChatTranscriptRoles;
	/** Reviewed-content or owner-answer kind. */
	readonly kind: PersonaFirstChatTranscriptKinds;
	/** Bounded plain text. */
	readonly text: string;
	/** One-based question coordinate, or null for the opening. */
	readonly questionOrdinal: number | null;
}

/** Exact next question selected by durable answer count. */
export interface PersonaFirstChatCurrentQuestion
{
	/** One-based reviewed question order. */
	readonly ordinal: number;
	/** Exact reviewed prompt. */
	readonly text: string;
}

/**
 * Carries the onboarding authority's complete, resumable view of the first chat.
 *
 * Every first-chat response replaces the browser's previous snapshot; callers must not merge local
 * progress into it. Before the chat starts, conversation evidence is null and the transcript is
 * empty. After the final answer, `currentQuestion` is null and `canConclude` says whether the
 * authority currently permits completion. {@link ___ParsePersonaFirstChatSnapshot} checks these
 * relationships before a feature or workspace projection can use the response.
 */
export interface PersonaFirstChatSnapshot
{
	/** Workflow definition version pinned to the owner record. */
	readonly workflowVersion: number;
	/** Current durable onboarding route. */
	readonly state: UserOnboardingRouteStates;
	/** Onboarding-only conversation identity, once started. */
	readonly conversationId: string | null;
	/** Approved persona evidence, or null before approval. */
	readonly persona: PersonaFirstChatPersona | null;
	/** Reviewed question-set pin, or null before approval. */
	readonly contentRevision: PersonaFirstChatContentRevision | null;
	/** Complete server-ordered transcript. */
	readonly transcript: readonly PersonaFirstChatTranscriptEntry[];
	/** Next server-selected question, or null when unavailable. */
	readonly currentQuestion: PersonaFirstChatCurrentQuestion | null;
	/** Number of durable answers. */
	readonly answerCount: number;
	/** Reviewed question count. */
	readonly questionCount: number;
	/** Whether the authority currently admits conclusion. */
	readonly canConclude: boolean;
	/** Conversation start time, or null before start. */
	readonly startedAt: string | null;
	/** Validated workflow completion time, or null while unfinished. */
	readonly completedAt: string | null;
}
