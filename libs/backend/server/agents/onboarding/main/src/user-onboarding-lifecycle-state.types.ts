import type { ApprovedPersonaEvidence, UserOnboardingOwner, UserOnboardingPersonaEvidencePort, UserOnboardingRecord, UserOnboardingRepository, UserOnboardingTransitionResult } from "./user-onboarding.types.js";

/** Dependencies available to one state-owned survey-start transition. */
export interface UserOnboardingSurveyStartContext
{
	/** Persistence authority for the owner-bound workflow row. */
	readonly repository: UserOnboardingRepository;
	/** Session-derived owner whose workflow may change. */
	readonly owner: UserOnboardingOwner;
	/** Durable workflow observed before the transition attempt. */
	readonly onboarding: UserOnboardingRecord;
	/** Persona-owned interview already verified for this owner. */
	readonly interviewId: string;
}

/** Dependencies available to one state-owned approved-persona transition. */
export interface UserOnboardingPersonaApprovalContext
{
	/** Persistence authority for the owner-bound workflow row. */
	readonly repository: UserOnboardingRepository;
	/** Session-derived owner whose workflow may change. */
	readonly owner: UserOnboardingOwner;
	/** Durable workflow observed before the transition attempt. */
	readonly onboarding: UserOnboardingRecord;
	/** Exact persona evidence already verified for this owner. */
	readonly evidence: ApprovedPersonaEvidence;
}

/** Dependencies available while reconciling a possibly interrupted persona approval. */
export interface UserOnboardingApprovalReconciliationContext
{
	/** Persistence authority for the owner-bound workflow row. */
	readonly repository: UserOnboardingRepository;
	/** Persona-owned reader for an approval committed before a workflow notification. */
	readonly personaEvidence: UserOnboardingPersonaEvidencePort;
	/** Session-derived owner whose workflow is being recovered. */
	readonly owner: UserOnboardingOwner;
	/** Durable workflow observed before recovery. */
	readonly onboarding: UserOnboardingRecord;
}

/** State-owned behaviour for each durable user-onboarding lifecycle state. */
export interface UserOnboardingLifecycleState
{
	/** Handle a verified request to start or resume a persona survey. */
	startSurvey(context: UserOnboardingSurveyStartContext): Promise<UserOnboardingTransitionResult>;
	/** Interpret the durable winner after a survey compare-and-set did not advance. */
	reconcileSurveyStart(context: UserOnboardingSurveyStartContext): UserOnboardingTransitionResult;
	/** Handle verified persona approval evidence for the current workflow state. */
	recordPersonaApproved(context: UserOnboardingPersonaApprovalContext): Promise<UserOnboardingTransitionResult>;
	/** Interpret the durable winner after an approval compare-and-set did not advance. */
	reconcilePersonaApprovalWrite(context: UserOnboardingPersonaApprovalContext): UserOnboardingTransitionResult;
	/** Recover approval evidence only where the workflow still permits it. */
	reconcilePersonaApproval(context: UserOnboardingApprovalReconciliationContext): Promise<UserOnboardingRecord>;
}
