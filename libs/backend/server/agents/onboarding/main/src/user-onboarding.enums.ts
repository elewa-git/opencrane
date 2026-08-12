/**
 * The state one user's onboarding is currently in, decided and stored by the server.
 *
 * Each user has one UserOnboarding row. Its state decides where the browser is sent next: run the
 * persona survey, run the guided bootstrap chat, or let the user into the main application. The
 * browser never chooses the state; it reads it from `GET /api/v1/me/onboarding`.
 *
 * The string values here are exactly what the database column stores and exactly what the API
 * returns, so changing a value breaks stored rows and every client at the same time. The Prisma
 * enum `UserOnboardingState` is a second copy of the same set and is translated in
 * prisma-user-onboarding-repository.ts; both must be changed together.
 *
 * States move in one direction only: SurveyPending -> SurveyInProgress -> BootstrapChatPending ->
 * BootstrapChatInProgress -> Completed.
 *
 * @see {@link UserOnboardingTransitionStatuses} for what a state-changing call reports back.
 */
export enum UserOnboardingStates
{
	/** The governed persona survey has not started. */
	SurveyPending = "survey_pending",
	/** One exact persona interview is active or awaiting approval. */
	SurveyInProgress = "survey_in_progress",
	/** The approved persona is pinned and bootstrap provisioning may begin. */
	BootstrapChatPending = "bootstrap_chat_pending",
	/** The guided bootstrap conversation is open and its script revision is pinned. */
	BootstrapChatInProgress = "bootstrap_chat_in_progress",
	/** Server-validated onboarding conclusion permits later main-application admission. */
	Completed = "completed",
}

/**
 * Why a completed onboarding row was allowed to be marked complete.
 *
 * Read this when you need to tell a user who genuinely finished onboarding from a user who was let
 * in by a migration. `BootstrapConcluded` means the server itself saw three valid answers and
 * closed the conversation. `ExistingUserMigration` means a named migration admitted somebody who
 * predates onboarding, so there is no conversation and no answers - a caller that tries to render a
 * transcript for those users will find nothing.
 *
 * The string values are stored in the `completionProvenance` column and returned by the API, and
 * they mirror the Prisma enum `UserOnboardingCompletionProvenance`.
 *
 * @see {@link UserOnboardingRecord.completionProvenance} the field that carries this value.
 */
export enum UserOnboardingCompletionProvenances
{
	/** Ordinary onboarding concluded through a server-validated bootstrap conversation. */
	BootstrapConcluded = "bootstrap_concluded",
	/** A named migration explicitly admitted a pre-onboarding existing user. */
	ExistingUserMigration = "existing_user_migration",
}

/**
 * What a survey or persona-approval call did to the stored workflow.
 *
 * These four are easy to confuse and a caller must handle them differently:
 * - `Advanced` - this call changed the stored state. Re-read the record and re-route the user.
 * - `Resumed` - the state was already exactly what this call wanted, usually a retry or a second
 *   browser tab. Treat it as success; do not show an error.
 * - `NoOp` - the call was valid but arrived too late to matter: the user is already past the survey,
 *   so a later persona change is accepted without dragging the workflow backwards.
 * - `Denied` - nothing changed and the request is not acceptable. Read
 *   {@link UserOnboardingDenialReasons} to decide what to tell the user.
 *
 * A caller that lumps `Denied` in with `NoOp` silently swallows a real rejection, and one that
 * treats `Resumed` as failure shows an error on every harmless retry.
 *
 * @see {@link UserOnboardingTransitionResult} the result union that carries this status.
 */
export enum UserOnboardingTransitionStatuses
{
	/** The durable workflow moved to its next state. */
	Advanced = "advanced",
	/** The same already-durable transition was safely resumed. */
	Resumed = "resumed",
	/** A later persona change was accepted, but the workflow was left where it was. */
	NoOp = "no_op",
	/** The requested transition conflicts with current durable state or evidence. */
	Denied = "denied",
}

/**
 * Why a survey or persona-approval call was rejected without changing anything.
 *
 * Onboarding never guesses: if a check fails it refuses and says which check, so a client can tell
 * a user mistake from a race. `InvalidReference` is a bad request (an empty id). `InterviewNotOwned`
 * and `PersonaNotApproved` mean the persona package would not confirm the interview, or the
 * approved revision, for this session's user - so the caller is asking about someone else's work or
 * about work that is not approved yet. `InterviewConflict` means this user already has a different
 * interview pinned; send them back to the one they started. `StateConflict` means another request
 * got there first, or the workflow has moved on - re-read the record and route from its new state.
 *
 * @see {@link UserOnboardingTransitionDenial} the result shape that carries this reason.
 */
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

/**
 * What happened when the user submitted one bootstrap-chat answer.
 *
 * Answers are append-only and each carries a retry key that is unique inside its conversation.
 * `Recorded` means a new answer row was written (the route answers 201). `Resumed` means that same
 * retry key, with the same text and the same question, was already stored - a double submit is
 * harmless (200). `IdempotencyConflict` means the retry key was already used with DIFFERENT text,
 * which is a client bug rather than a race. `StateConflict` means the conversation will not take
 * that answer right now, most often because the user answered a stale question. The last two both
 * return 409 together with the current chat, so the client re-renders instead of guessing.
 *
 * @see {@link UserOnboardingAnswerResult} the value returned to the HTTP layer.
 */
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

/**
 * Why a guided-chat request was refused, in a form that is safe to send to the browser.
 *
 * Each of these is thrown as a {@link UserOnboardingChatError} and mapped to a fixed HTTP status by
 * the router, so the grouping matters. `InvalidAnswer`, `InvalidIdempotencyKey`, and
 * `InvalidCoordinate` are 400 - the client sent something out of bounds. `NotReady`,
 * `StateConflict`, and `NotConcludable` are 409 - the request is well formed but the workflow is
 * not at that point. `EvidenceUnavailable` is 503 because the approved persona row or its reviewed
 * script could not be read, which is a server-side problem the user can retry.
 *
 * @see {@link UserOnboardingChatError} the error class that carries this reason to the router.
 */
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
