import type { ApprovedPersonaEvidence, UserOnboardingOwner, UserOnboardingPersonaEvidencePort, UserOnboardingRecord, UserOnboardingRepository, UserOnboardingTransitionResult } from "./user-onboarding.types";

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

/**
 * The behaviour each onboarding state supplies, so no state is ever handled by an `if` chain.
 *
 * One class per stored state implements this, and `_STATES` in user-onboarding-lifecycle-state.ts
 * maps every {@link UserOnboardingStates} member to one of them - that mapping is what makes the
 * set complete. The three `reconcile*` methods exist because every write here is a conditional
 * update: when a write applies to zero rows the row has moved on, and the method for the NEW state
 * decides whether that outcome is what the caller wanted, harmlessly late, or wrong.
 *
 * Called by: _UserOnboardingLifecycleState in user-onboarding-lifecycle-state.ts, the only place
 * these methods are reached from.
 */
export interface UserOnboardingLifecycleState
{
	/** Handle a verified request to start or resume a persona survey. */
	startSurvey(context: UserOnboardingSurveyStartContext): Promise<UserOnboardingTransitionResult>;
	/** Decide what to report when the survey update applied to zero rows, based on the state the row is in now. */
	reconcileSurveyStart(context: UserOnboardingSurveyStartContext): UserOnboardingTransitionResult;
	/** Handle verified persona approval evidence for the current workflow state. */
	recordPersonaApproved(context: UserOnboardingPersonaApprovalContext): Promise<UserOnboardingTransitionResult>;
	/** Interpret the durable winner after an approval compare-and-set did not advance. */
	reconcilePersonaApprovalWrite(context: UserOnboardingPersonaApprovalContext): UserOnboardingTransitionResult;
	/** Recover approval evidence only where the workflow still permits it. */
	reconcilePersonaApproval(context: UserOnboardingApprovalReconciliationContext): Promise<UserOnboardingRecord>;
}
