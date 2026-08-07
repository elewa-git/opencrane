/** Stable persona lifecycle outcomes shared by local authorities and their HTTP adapter. */
export enum PersonaLifecycleOutcomes
{
	/** The owner profile and reviewed onboarding catalogue are available. */
	Ready = "ready",
	/** A request was refused without mutating persona evidence. */
	Denied = "denied",
	/** A fresh interview was recorded. */
	Started = "started",
	/** An existing in-progress interview was safely reused. */
	AlreadyInProgress = "already_in_progress",
	/** An immutable interview answer was appended. */
	Recorded = "recorded",
	/** An interview was frozen with complete evidence. */
	Completed = "completed",
	/** A reviewable persona draft was created. */
	Created = "created",
	/** A persona draft was approved and activated. */
	Approved = "approved",
	/** The requested persona authority record does not exist for the owner. */
	NotFound = "not_found",
}

/** Stable owner-visible resumable-state vocabulary exposed by the owner-only persona onboarding API. */
export enum PersonaOnboardingApiStates
{
	/** The owner needs to start or continue their interview. */
	Interview = "interview",
	/** A derived draft awaits the owner's review. */
	Review = "review",
	/** An approved persona makes a personal session eligible. */
	Ready = "ready",
	/** The owner is answering the reviewed interview. */
	InProgress = "in_progress",
	/** The owner completed the interview. */
	Completed = "completed",
	/** The owner is reviewing a derived draft. */
	Draft = "draft",
	/** The owner approved the active persona revision. */
	Approved = "approved",
}

/** Persona authority denials that map to bounded HTTP statuses without leaking ownership. */
export enum PersonaInterviewDenialReasons
{
	/** The request omitted a required owner, interview, question, or trusted instant. */
	InvalidCommand = "invalid_command",
	/** Persistence could not produce an authoritative result. */
	PersistenceUnavailable = "persistence_unavailable",
	/** The reviewed question set is unavailable. */
	QuestionSetUnavailable = "question_set_unavailable",
	/** The requested interview or profile is not visible to the caller. */
	NotFoundOrWrongOwner = "not_found_or_wrong_owner",
	/** The requested configuration refresh is not available to the owner. */
	RefreshChangeUnavailable = "refresh_change_unavailable",
	/** The exact question already has immutable answer evidence. */
	AlreadyAnswered = "already_answered",
	/** The requested question is absent from the reviewed revision frozen into the interview. */
	QuestionUnavailable = "question_unavailable",
	/** The interview has advanced beyond its mutable state. */
	NotInProgress = "not_in_progress",
	/** The required reviewed answers are incomplete. */
	IncompleteAnswers = "incomplete_answers",
	/** Another refresh already owns the active interview. */
	RefreshInterviewConflict = "refresh_interview_conflict",
	/** A concurrent write prevented the interview transaction from committing. */
	Conflict = "conflict",
}
