import type { UserOnboardingCompletionProvenances, UserOnboardingDenialReasons, UserOnboardingStates, UserOnboardingTransitionStatuses } from "./user-onboarding.enums.js";

/** Trusted owner coordinates derived from the authenticated server session. */
export interface UserOnboardingOwner
{
	/** Organisation silo derived from the verified request principal. */
	readonly siloId: string;
	/** Stable OIDC subject derived from the verified request principal. */
	readonly subjectId: string;
}

/** Server projection of one user's pinned onboarding workflow. */
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

/** Persona-owned evidence checks required by onboarding without sharing persistence authority. */
export interface UserOnboardingPersonaEvidencePort
{
	/** Confirm that an interview belongs to the session-derived owner. */
	ownsInterview(owner: UserOnboardingOwner, interviewId: string): Promise<boolean>;
	/** Confirm the exact approved revision was produced by the exact owner-bound interview. */
	readApprovedPersona(owner: UserOnboardingOwner, evidence: ApprovedPersonaEvidence): Promise<ApprovedPersonaEvidence | null>;
	/** Return the latest approved revision for the exact owner-bound interview, when one exists. */
	readLatestApprovedPersona(owner: UserOnboardingOwner, interviewId: string): Promise<ApprovedPersonaEvidence | null>;
}

/** Persistence operations owned exclusively by the user-onboarding package. */
export interface UserOnboardingRepository
{
	/** Return the current workflow or create a pinned survey-pending workflow. */
	ensure(owner: UserOnboardingOwner, currentWorkflowVersion: number): Promise<UserOnboardingRecord>;
	/** Return the current owner-bound workflow without creating one. */
	read(owner: UserOnboardingOwner): Promise<UserOnboardingRecord | null>;
	/** Atomically pin an interview and enter survey-in-progress from a survey state. */
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
