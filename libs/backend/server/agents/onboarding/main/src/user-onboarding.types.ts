import type { UserOnboardingCompletionProvenances, UserOnboardingDenialReasons, UserOnboardingStates, UserOnboardingTransitionStatuses } from "./user-onboarding.enums";
import type { ApprovedPersonaBootstrapEvidence } from "./user-onboarding-chat.types";

/**
 * The user whose onboarding is being read or changed, taken only from the verified server session.
 *
 * Both fields come from the authenticated request principal. Nothing in this package ever accepts a
 * silo or a subject from a request body, a query string, or a header - if it did, any signed-in
 * user could drive another user's onboarding. The app builds this value in
 * apps/opencrane/src/app/routes.ts and passes it in as a {@link UserOnboardingOwnerResolver}.
 *
 * The two fields together are the lookup key for every row in this package (the `siloId_userId`
 * unique key in Postgres).
 */
export interface UserOnboardingOwner
{
	/** Organisation silo derived from the verified request principal. */
	readonly siloId: string;
	/** Stable OIDC subject derived from the verified request principal. */
	readonly subjectId: string;
}

/**
 * One user's stored onboarding row, converted for callers so no Prisma model leaks out.
 *
 * This is what every route and authority method hands back, and the only place to read the current
 * state from. The nullable id fields fill in as the user moves forward and are then frozen:
 * `personaInterviewId` when the survey starts, `personaRevisionId` when the persona is approved,
 * then the three `bootstrap*` fields when the guided chat starts. A null therefore means "not
 * reached yet", never "lost". Only `state` should drive routing; the ids are for showing and
 * checking what is pinned.
 *
 * @see {@link UserOnboardingStates} for what each state means.
 */
export interface UserOnboardingRecord
{
	/** Stable workflow record identifier. */
	readonly id: string;
	/** Organisation silo that owns the workflow. */
	readonly siloId: string;
	/** Stable OIDC subject that owns the workflow. */
	readonly subjectId: string;
	/** Workflow definition version pinned when the record was created. */
	readonly workflowVersion: number;
	/** Current durable routing state. */
	readonly state: UserOnboardingStates;
	/** Exact governed persona interview, once survey work begins. */
	readonly personaInterviewId: string | null;
	/** Exact approved persona revision, once the survey is concluded. */
	readonly personaRevisionId: string | null;
	/** Exact onboarding-only conversation, once bootstrap work begins. */
	readonly bootstrapConversationId: string | null;
	/** Immutable retrievable bootstrap content revision pinned for the conversation. */
	readonly bootstrapContentRevisionId: string | null;
	/** Integrity digest of the pinned bootstrap content revision. */
	readonly bootstrapContentDigest: string | null;
	/** Server-validated reason a completed workflow was admitted. */
	readonly completionProvenance: UserOnboardingCompletionProvenances | null;
	/** Named migration revision for an explicitly seeded existing user. */
	readonly completionMigrationRevision: string | null;
	/** Named migration batch for an explicitly seeded existing user. */
	readonly completionMigrationBatch: string | null;
	/** Time the workflow record was first created. */
	readonly startedAt: Date;
	/** Time the survey first became active. */
	readonly surveyStartedAt: Date | null;
	/** Time server-validated onboarding concluded. */
	readonly completedAt: Date | null;
	/** Time any durable workflow field last changed. */
	readonly updatedAt: Date;
}

/** Exact approved persona evidence supplied by the persona authority. */
export interface ApprovedPersonaEvidence
{
	/** Exact interview that produced the revision. */
	readonly interviewId: string;
	/** Exact immutable approved revision. */
	readonly personaRevisionId: string;
}

/**
 * The four questions onboarding asks the persona package, so neither package touches the other's tables.
 *
 * Onboarding stores no persona data and never queries persona tables. Before it will pin an
 * interview or an approved revision it asks here, and every method takes the session-derived
 * {@link UserOnboardingOwner} so persona can scope its own query to that user. A null or false
 * answer always means "refuse" - never "assume yes".
 *
 * Called by: __UserOnboardingAuthority and __UserOnboardingChatAuthority in this package;
 * implemented in apps/opencrane/src/app/user-onboarding-composition.ts over
 * PersonaWorkflowEvidenceRepository.
 */
export interface UserOnboardingPersonaEvidencePort
{
	/** Confirm that an interview belongs to the session-derived owner. */
	ownsInterview(owner: UserOnboardingOwner, interviewId: string): Promise<boolean>;
	/** Confirm the exact approved revision was produced by the exact owner-bound interview. */
	readApprovedPersona(owner: UserOnboardingOwner, evidence: ApprovedPersonaEvidence): Promise<ApprovedPersonaEvidence | null>;
	/** Return the latest approved revision for the exact owner-bound interview, when one exists. */
	readLatestApprovedPersona(owner: UserOnboardingOwner, interviewId: string): Promise<ApprovedPersonaEvidence | null>;
	/** Return safe display and archetype selection facts for the exact active approved revision. */
	readApprovedBootstrapEvidence(owner: UserOnboardingOwner, personaRevisionId: string): Promise<ApprovedPersonaBootstrapEvidence | null>;
}

/**
 * The only writes onboarding may make to its own UserOnboarding row.
 *
 * The `mark*` and `replace*` methods return a boolean rather than a record. `true` means this call
 * made the change; `false` means the row was not in the state the call required, because another
 * request changed it first or the user is already further along. `false` is expected, not an error -
 * the caller re-reads the row and lets the state object for the NEW state decide what to report.
 * Nothing here throws for a lost race.
 *
 * Called by: __UserOnboardingAuthority and the state objects in user-onboarding-lifecycle-state.ts;
 * implemented by PrismaUserOnboardingRepository, composed by _CreateUserOnboardingRepository in
 * apps/opencrane/src/app/user-onboarding-composition.ts.
 *
 * @see {@link UserOnboardingChatRepository} for the guided-chat half of persistence.
 */
export interface UserOnboardingRepository
{
	/** Return the current workflow or create a pinned survey-pending workflow. */
	ensure(owner: UserOnboardingOwner, currentWorkflowVersion: number): Promise<UserOnboardingRecord>;
	/** Return the current owner-bound workflow without creating one. */
	read(owner: UserOnboardingOwner): Promise<UserOnboardingRecord | null>;
	/**
	 * Pin this interview and move the row to survey-in-progress, in one conditional update.
	 *
	 * Also succeeds when the row is already survey-in-progress with this exact interview, so a retry
	 * is harmless. It will not touch a row that has a different interview pinned or that has moved
	 * past the survey.
	 *
	 * @param owner - Session-derived user whose row may change.
	 * @param interviewId - Interview the persona package has already confirmed belongs to this user.
	 * @returns true when this call pinned or re-confirmed the interview; false when the row was in
	 * some other state, in which case the caller must re-read it.
	 */
	markSurveyInProgress(owner: UserOnboardingOwner, interviewId: string): Promise<boolean>;
	/** Atomically replace the expected initial-survey interview before any later evidence exists. */
	replaceSurveyInterview(owner: UserOnboardingOwner, expectedInterviewId: string, replacementInterviewId: string): Promise<boolean>;
	/** Atomically pin approved persona evidence and enter bootstrap-chat-pending. */
	markPersonaApproved(owner: UserOnboardingOwner, evidence: ApprovedPersonaEvidence): Promise<boolean>;
}

/** Successful transition result carrying the authoritative workflow projection. */
export interface UserOnboardingTransitionSuccess
{
	/** Whether this call advanced or resumed the durable transition. */
	readonly status: UserOnboardingTransitionStatuses.Advanced | UserOnboardingTransitionStatuses.Resumed | UserOnboardingTransitionStatuses.NoOp;
	/** Current authoritative workflow projection. */
	readonly onboarding: UserOnboardingRecord;
}

/** Denied transition result with a stable fail-closed reason. */
export interface UserOnboardingTransitionDenial
{
	/** Stable denied discriminator. */
	readonly status: UserOnboardingTransitionStatuses.Denied;
	/** Reason the requested transition was not admitted. */
	readonly reason: UserOnboardingDenialReasons;
	/** Current workflow when one exists, for deterministic recovery routing. */
	readonly onboarding: UserOnboardingRecord | null;
}

/** Exhaustive transition result for survey lifecycle orchestration. */
export type UserOnboardingTransitionResult = UserOnboardingTransitionSuccess | UserOnboardingTransitionDenial;
