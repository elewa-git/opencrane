/** Server-owned onboarding route used by both navigation and the first-chat projection. */
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

/** Approved persona archetype that selects reviewed first-chat material. */
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

/** Approved persona colour coordinate carried by the projection. */
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

/** Speaker role for one transcript entry. */
export enum PersonaFirstChatTranscriptRoles
{
	/** Reviewed opening or question material. */
	Assistant = "assistant",
	/** One admitted owner answer. */
	User = "user"
}

/** Evidence kind for one transcript entry. */
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

/** Complete resumable first-chat projection returned by the onboarding authority. */
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
