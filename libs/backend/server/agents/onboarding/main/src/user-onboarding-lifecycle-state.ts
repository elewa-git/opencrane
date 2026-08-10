import { UserOnboardingDenialReasons, UserOnboardingStates, UserOnboardingTransitionStatuses } from "./user-onboarding.enums.js";
import type { UserOnboardingApprovalReconciliationContext, UserOnboardingLifecycleState, UserOnboardingPersonaApprovalContext, UserOnboardingSurveyStartContext } from "./user-onboarding-lifecycle-state.types.js";
import type { UserOnboardingRecord, UserOnboardingTransitionResult } from "./user-onboarding.types.js";

/** Resolve the state object that exclusively owns one durable onboarding state. */
export function _UserOnboardingLifecycleState(onboarding: UserOnboardingRecord): UserOnboardingLifecycleState
{
	return _STATES[onboarding.state];
}

/** State behaviour before the owner has pinned an initial survey interview. */
class _SurveyPendingState implements UserOnboardingLifecycleState
{
	/** Start the one initial survey permitted from an empty pending record. */
	async startSurvey(context: UserOnboardingSurveyStartContext): Promise<UserOnboardingTransitionResult>
	{
		if (context.onboarding.personaInterviewId !== null) return _Denied(UserOnboardingDenialReasons.StateConflict, context.onboarding);
		const advanced = await context.repository.markSurveyInProgress(context.owner, context.interviewId);
		return _SurveyWriteResult(context.repository, context.owner, context.interviewId, advanced);
	}

	/** Deny a failed write that remained pending because no other valid transition won. */
	reconcileSurveyStart(context: UserOnboardingSurveyStartContext): UserOnboardingTransitionResult
	{
		return _Denied(UserOnboardingDenialReasons.StateConflict, context.onboarding);
	}

	/** Deny approval before an owner-bound interview has become active. */
	async recordPersonaApproved(context: UserOnboardingPersonaApprovalContext): Promise<UserOnboardingTransitionResult>
	{
		return _Denied(UserOnboardingDenialReasons.StateConflict, context.onboarding);
	}

	/** Deny a failed approval write that remained pending. */
	reconcilePersonaApprovalWrite(context: UserOnboardingPersonaApprovalContext): UserOnboardingTransitionResult
	{
		return _Denied(UserOnboardingDenialReasons.StateConflict, context.onboarding);
	}

	/** Retain a pending record because no survey interview can yield approval evidence yet. */
	async reconcilePersonaApproval(context: UserOnboardingApprovalReconciliationContext): Promise<UserOnboardingRecord>
	{
		return context.onboarding;
	}
}

/** State behaviour while an owner-bound persona interview remains the current survey. */
class _SurveyInProgressState implements UserOnboardingLifecycleState
{
	/** Resume the same interview or replace only the still-initial interview by CAS. */
	async startSurvey(context: UserOnboardingSurveyStartContext): Promise<UserOnboardingTransitionResult>
	{
		if (context.onboarding.personaInterviewId === context.interviewId) return _Resumed(context.onboarding);
		if (context.onboarding.personaInterviewId === null) return _Denied(UserOnboardingDenialReasons.StateConflict, context.onboarding);
		const advanced = await context.repository.replaceSurveyInterview(context.owner, context.onboarding.personaInterviewId, context.interviewId);
		return _SurveyWriteResult(context.repository, context.owner, context.interviewId, advanced);
	}

	/** Resume the winner when it pinned this interview; otherwise report its incompatible survey. */
	reconcileSurveyStart(context: UserOnboardingSurveyStartContext): UserOnboardingTransitionResult
	{
		if (context.onboarding.personaInterviewId === context.interviewId) return _Resumed(context.onboarding);
		return _Denied(context.onboarding.personaInterviewId === null ? UserOnboardingDenialReasons.StateConflict : UserOnboardingDenialReasons.InterviewConflict, context.onboarding);
	}

	/** Advance only when the approved persona evidence names this exact active interview. */
	async recordPersonaApproved(context: UserOnboardingPersonaApprovalContext): Promise<UserOnboardingTransitionResult>
	{
		if (context.onboarding.personaInterviewId !== context.evidence.interviewId) return _Denied(UserOnboardingDenialReasons.InterviewConflict, context.onboarding);
		const advanced = await context.repository.markPersonaApproved(context.owner, context.evidence);
		return _ApprovalWriteResult(context.repository, context.owner, context.evidence, advanced);
	}

	/** Deny a failed approval write according to the durable interview selected by the winner. */
	reconcilePersonaApprovalWrite(context: UserOnboardingPersonaApprovalContext): UserOnboardingTransitionResult
	{
		return _Denied(context.onboarding.personaInterviewId === context.evidence.interviewId ? UserOnboardingDenialReasons.StateConflict : UserOnboardingDenialReasons.InterviewConflict, context.onboarding);
	}

	/** Recover an approval atomically when persona committed before its workflow notification. */
	async reconcilePersonaApproval(context: UserOnboardingApprovalReconciliationContext): Promise<UserOnboardingRecord>
	{
		if (context.onboarding.personaInterviewId === null) return context.onboarding;
		const approved = await context.personaEvidence.readLatestApprovedPersona(context.owner, context.onboarding.personaInterviewId);
		if (approved === null || approved.interviewId !== context.onboarding.personaInterviewId) return context.onboarding;
		await context.repository.markPersonaApproved(context.owner, approved);
		return await context.repository.read(context.owner) ?? context.onboarding;
	}
}

/** State behaviour once initial survey provenance is frozen behind bootstrap work. */
class _BootstrapChatPendingState implements UserOnboardingLifecycleState
{
	/** Accept later persona maintenance without regressing the initial workflow. */
	async startSurvey(context: UserOnboardingSurveyStartContext): Promise<UserOnboardingTransitionResult>
	{
		return _NoOp(context.onboarding);
	}

	/** Preserve frozen initial-survey provenance after a failed late survey write. */
	reconcileSurveyStart(context: UserOnboardingSurveyStartContext): UserOnboardingTransitionResult
	{
		return _NoOp(context.onboarding);
	}

	/** Resume only the exact already-pinned approval; other maintenance remains a no-op. */
	async recordPersonaApproved(context: UserOnboardingPersonaApprovalContext): Promise<UserOnboardingTransitionResult>
	{
		return context.onboarding.personaInterviewId === context.evidence.interviewId && context.onboarding.personaRevisionId === context.evidence.personaRevisionId
			? _Resumed(context.onboarding)
			: _NoOp(context.onboarding);
	}

	/** Resume only a matching approval durable winner; preserve other maintenance as no-op. */
	reconcilePersonaApprovalWrite(context: UserOnboardingPersonaApprovalContext): UserOnboardingTransitionResult
	{
		return context.onboarding.personaInterviewId === context.evidence.interviewId && context.onboarding.personaRevisionId === context.evidence.personaRevisionId
			? _Resumed(context.onboarding)
			: _NoOp(context.onboarding);
	}

	/** Retain frozen initial-survey provenance once bootstrap work may begin. */
	async reconcilePersonaApproval(context: UserOnboardingApprovalReconciliationContext): Promise<UserOnboardingRecord>
	{
		return context.onboarding;
	}
}

/** State behaviour once bootstrap work has begun or onboarding has completed. */
class _FrozenWorkflowState implements UserOnboardingLifecycleState
{
	/** Accept later persona maintenance without changing frozen initial-survey provenance. */
	async startSurvey(context: UserOnboardingSurveyStartContext): Promise<UserOnboardingTransitionResult>
	{
		return _NoOp(context.onboarding);
	}

	/** Preserve a frozen later workflow after a failed survey write. */
	reconcileSurveyStart(context: UserOnboardingSurveyStartContext): UserOnboardingTransitionResult
	{
		return _NoOp(context.onboarding);
	}

	/** Accept verified persona maintenance without changing a later workflow state. */
	async recordPersonaApproved(context: UserOnboardingPersonaApprovalContext): Promise<UserOnboardingTransitionResult>
	{
		return _NoOp(context.onboarding);
	}

	/** Preserve a frozen later workflow after a failed approval write. */
	reconcilePersonaApprovalWrite(context: UserOnboardingPersonaApprovalContext): UserOnboardingTransitionResult
	{
		return _NoOp(context.onboarding);
	}

	/** Retain the workflow because later states never reconcile initial survey approval. */
	async reconcilePersonaApproval(context: UserOnboardingApprovalReconciliationContext): Promise<UserOnboardingRecord>
	{
		return context.onboarding;
	}
}

/** Exhaustive state dispatch for every durable onboarding state. */
const _STATES: Readonly<Record<UserOnboardingStates, UserOnboardingLifecycleState>> = {
	[UserOnboardingStates.SurveyPending]: new _SurveyPendingState(),
	[UserOnboardingStates.SurveyInProgress]: new _SurveyInProgressState(),
	[UserOnboardingStates.BootstrapChatPending]: new _BootstrapChatPendingState(),
	[UserOnboardingStates.BootstrapChatInProgress]: new _FrozenWorkflowState(),
	[UserOnboardingStates.Completed]: new _FrozenWorkflowState(),
};

/** Re-read after a survey CAS so races are interpreted by the durable winner's state object. */
async function _SurveyWriteResult(repository: UserOnboardingSurveyStartContext["repository"], owner: UserOnboardingSurveyStartContext["owner"], interviewId: string, advanced: boolean): Promise<UserOnboardingTransitionResult>
{
	const after = await repository.read(owner);
	if (advanced && after !== null) return { status: UserOnboardingTransitionStatuses.Advanced, onboarding: after };
	if (after === null) return _Denied(UserOnboardingDenialReasons.StateConflict, null);
	return _UserOnboardingLifecycleState(after).reconcileSurveyStart({ repository, owner, onboarding: after, interviewId });
}

/** Re-read after an approval CAS so retries use the durable winner's state behaviour. */
async function _ApprovalWriteResult(repository: UserOnboardingPersonaApprovalContext["repository"], owner: UserOnboardingPersonaApprovalContext["owner"], evidence: UserOnboardingPersonaApprovalContext["evidence"], advanced: boolean): Promise<UserOnboardingTransitionResult>
{
	const after = await repository.read(owner);
	if (advanced && after !== null) return { status: UserOnboardingTransitionStatuses.Advanced, onboarding: after };
	if (after === null) return _Denied(UserOnboardingDenialReasons.StateConflict, null);
	return _UserOnboardingLifecycleState(after).reconcilePersonaApprovalWrite({ repository, owner, onboarding: after, evidence });
}

/** Build one denied state transition without exposing unrelated owner state. */
function _Denied(reason: UserOnboardingDenialReasons, onboarding: UserOnboardingRecord | null): UserOnboardingTransitionResult
{
	return { status: UserOnboardingTransitionStatuses.Denied, reason, onboarding };
}

/** Build one idempotent state transition result. */
function _Resumed(onboarding: UserOnboardingRecord): UserOnboardingTransitionResult
{
	return { status: UserOnboardingTransitionStatuses.Resumed, onboarding };
}

/** Build one accepted persona-maintenance result that cannot regress workflow provenance. */
function _NoOp(onboarding: UserOnboardingRecord): UserOnboardingTransitionResult
{
	return { status: UserOnboardingTransitionStatuses.NoOp, onboarding };
}
