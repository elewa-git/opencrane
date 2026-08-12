/**
 * The success outcomes every persona use case returns, plus the single shared `Denied` outcome.
 *
 * One enum covers the whole lifecycle so the router can branch on `outcome` the same way for every
 * route: anything that is not `Denied` succeeded, and the specific value says what happened. The
 * reason for a `Denied` lives in a separate per-step enum, because the interview, draft, and approval
 * steps can fail for quite different causes.
 *
 * Two pairs are easy to conflate and must not be. `Started` and `AlreadyInProgress` are both success —
 * the second means the owner already had an interview open and it was reused, not that anything went
 * wrong. `Completed` means the interview is frozen and scored, while `Approved` means the persona is
 * active; treating `Completed` as the end of onboarding would leave the owner without a usable persona.
 *
 * @see PersonaInterviewDenialReasons
 * @see PersonaApprovalDenialReasons
 * @see PersonaDraftDenialReasons
 */
export enum PersonaLifecycleOutcomes
{
	/** The owner profile and reviewed onboarding catalogue are available. */
	Ready = "ready",
	/** A request was refused without mutating persona evidence. */
	Denied = "denied",
	/** A fresh interview was recorded. */
	Started = "started",
	/** An interview was already in progress, so it was reused. */
	AlreadyInProgress = "already_in_progress",
	/** An immutable interview answer was appended. */
	Recorded = "recorded",
	/** Every question had an answer, so the interview was frozen. */
	Completed = "completed",
	/** A reviewable persona draft was created. */
	Created = "created",
	/** A persona draft was approved and activated. */
	Approved = "approved",
	/** No such persona row exists for this owner. */
	NotFound = "not_found",
}

/** The states the owner's own onboarding API reports, so a browser can resume where it left off. */
export enum PersonaOnboardingApiStates
{
	/** The owner needs to start or continue their interview. */
	Interview = "interview",
	/** A derived draft awaits the owner's review. */
	Review = "review",
	/** Scoring finished in a tie, so the owner must pick between the tied candidates. */
	Resolution = "resolution",
	/** The owner has an approved persona, so a personal agent session may start. */
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

/** Reasons the interview use cases refuse a request. The router turns each into an HTTP status that does not reveal whether another user owns the row. */
export enum PersonaInterviewDenialReasons
{
	/** The request left out the owner, interview, question, or timestamp. */
	InvalidCommand = "invalid_command",
	/** The database call failed, so no result can be trusted. */
	PersistenceUnavailable = "persistence_unavailable",
	/** The reviewed question set is unavailable. */
	QuestionSetUnavailable = "question_set_unavailable",
	/** The requested interview or profile is not visible to the caller. */
	NotFoundOrWrongOwner = "not_found_or_wrong_owner",
	/** The requested configuration refresh is not available to the owner. */
	RefreshChangeUnavailable = "refresh_change_unavailable",
	/** This question has already been answered, and answers cannot be changed. */
	AlreadyAnswered = "already_answered",
	/** The question is not in the question-set version this interview was pinned to. */
	QuestionUnavailable = "question_unavailable",
	/** The tie, or the candidate chosen for it, is not the tie the stored score is waiting on. */
	InvalidResolution = "invalid_resolution",
	/** The owner already chose for this tie, and that choice cannot be changed. */
	AlreadyResolved = "already_resolved",
	/** The interview is no longer in progress, so it cannot be changed. */
	NotInProgress = "not_in_progress",
	/** Some questions are still unanswered. */
	IncompleteAnswers = "incomplete_answers",
	/** The in-progress interview belongs to a different refresh request. */
	RefreshInterviewConflict = "refresh_interview_conflict",
	/** A concurrent write prevented the interview transaction from committing. */
	Conflict = "conflict",
}
