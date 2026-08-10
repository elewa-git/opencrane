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
