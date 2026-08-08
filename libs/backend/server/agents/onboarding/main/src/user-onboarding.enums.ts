/**
 * Durable server-owned routing states for one user's pinned onboarding workflow.
 *
 * The string values are the API and persistence vocabulary; callers must not invent parallel
 * browser-owned states.
 */
export enum UserOnboardingStates
{
	/** The governed persona survey has not started. */
	SurveyPending = "survey_pending",
	/** One exact persona interview is active or awaiting approval. */
	SurveyInProgress = "survey_in_progress",
	/** The approved persona is pinned and bootstrap provisioning may begin. */
	BootstrapChatPending = "bootstrap_chat_pending",
	/** One exact bootstrap conversation and content revision are in progress. */
	BootstrapChatInProgress = "bootstrap_chat_in_progress",
	/** Server-validated onboarding conclusion permits later main-application admission. */
	Completed = "completed",
}

/** Durable proof categories for completed onboarding records. */
export enum UserOnboardingCompletionProvenances
{
	/** Ordinary onboarding concluded through a server-validated bootstrap conversation. */
	BootstrapConcluded = "bootstrap_concluded",
	/** A named migration explicitly admitted a pre-onboarding existing user. */
	ExistingUserMigration = "existing_user_migration",
}

/** Stable outcomes returned by survey transition methods. */
export enum UserOnboardingTransitionStatuses
{
	/** The durable workflow moved to its next state. */
	Advanced = "advanced",
	/** The same already-durable transition was safely resumed. */
	Resumed = "resumed",
	/** A valid persona maintenance event was accepted without changing initial-onboarding provenance. */
	NoOp = "no_op",
	/** The requested transition conflicts with current durable state or evidence. */
	Denied = "denied",
}

/** Stable fail-closed explanations for denied onboarding transitions. */
export enum UserOnboardingDenialReasons
{
	/** A required identifier was empty. */
	InvalidReference = "invalid_reference",
	/** The persona authority did not confirm the interview for this session owner. */
	InterviewNotOwned = "interview_not_owned",
	/** The persona authority did not confirm the exact approved revision and interview. */
	PersonaNotApproved = "persona_not_approved",
	/** The requested interview differs from the one already pinned to this workflow. */
	InterviewConflict = "interview_conflict",
	/** The workflow's current durable state does not allow the requested transition. */
	StateConflict = "state_conflict",
}

/** Approved persona archetypes that select one reviewed bootstrap script. */
export enum UserOnboardingBootstrapArchetypes
{
	/** Direct, results-focused red persona. */
	Commander = "commander",
	/** Energetic, collaborative yellow persona. */
	Catalyst = "catalyst",
	/** Calm, supportive green persona. */
	Anchor = "anchor",
	/** Precise, structured blue persona. */
	Analyst = "analyst",
}

/** Stable colours exposed only as approved persona display evidence. */
export enum UserOnboardingPersonaColours
{
	/** Commander display colour. */
	Red = "red",
	/** Catalyst display colour. */
	Yellow = "yellow",
	/** Anchor display colour. */
	Green = "green",
	/** Analyst display colour. */
	Blue = "blue",
}

/** Speaker roles in the deterministic onboarding-only transcript projection. */
export enum UserOnboardingChatRoles
{
	/** Reviewed server-owned script content. */
	Assistant = "assistant",
	/** Exact bounded text submitted by the authenticated owner. */
	User = "user",
}

/** Stable content categories in the deterministic transcript projection. */
export enum UserOnboardingChatMessageKinds
{
	/** Reviewed archetype-specific introduction. */
	Opening = "opening",
	/** One of the three reviewed ordered prompts. */
	Question = "question",
	/** One append-only owner answer. */
	Answer = "answer",
}

/** Outcomes for append-only answer submission. */
export enum UserOnboardingAnswerStatuses
{
	/** One new bounded answer was appended. */
	Recorded = "recorded",
	/** The same key and text already produced the durable answer. */
	Resumed = "resumed",
	/** The key was already used with different text. */
	IdempotencyConflict = "idempotency_conflict",
	/** The chat state does not currently accept another answer. */
	StateConflict = "state_conflict",
}

/** Stable fail-closed errors exposed by the guided onboarding chat boundary. */
export enum UserOnboardingChatFailureReasons
{
	/** The persona survey has not produced an approved revision yet. */
	NotReady = "not_ready",
	/** Approved persona evidence or its reviewed script revision is unavailable. */
	EvidenceUnavailable = "evidence_unavailable",
	/** The durable workflow changed during the requested compare-and-set transition. */
	StateConflict = "state_conflict",
	/** Answer text is empty or exceeds the server-owned limit. */
	InvalidAnswer = "invalid_answer",
	/** The retry key is empty or exceeds the server-owned limit. */
	InvalidIdempotencyKey = "invalid_idempotency_key",
	/** The expected conversation or question coordinate is malformed. */
	InvalidCoordinate = "invalid_coordinate",
	/** Exactly three valid answers are required before conclusion. */
	NotConcludable = "not_concludable",
}
