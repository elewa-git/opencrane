import { UserOnboardingDenialReasons, UserOnboardingStates, UserOnboardingTransitionStatuses } from "./user-onboarding.enums.js";
import type { UserOnboardingApprovalReconciliationContext, UserOnboardingLifecycleState, UserOnboardingPersonaApprovalContext, UserOnboardingSurveyStartContext } from "./user-onboarding-lifecycle-state.types.js";
import type { UserOnboardingRecord, UserOnboardingTransitionResult } from "./user-onboarding.types.js";

/**
 * Pick the object that owns the behaviour for the row's current state.
 *
 * Every state-changing operation in this package is written twice: once as "try it" and once as
 * "decide what to report if the try did not take effect". Both live on the state object, so adding
 * a state cannot leave a hole.
 *
 * All writes here are conditional updates - they apply only if the row still looks the way it did
 * when it was read. When two requests race (two browser tabs, a retry, a persona callback arriving
 * twice) one update applies and the other changes zero rows. Changing zero rows is NOT a failure:
 * the row simply moved on. The caller re-reads the row, calls this function again with the new
 * state, and the matching `reconcile*` method says whether the outcome is really what the caller
 * wanted (report resumed), harmlessly late (report no-op), or genuinely wrong (report denied).
 *
 * Called by: __UserOnboardingAuthority.startSurvey / recordApprovedPersona / readOrCreate, and the
 * re-read helpers in this file.
 *
 * @param onboarding - The row as it was just read.
 * @returns The state object for `onboarding.state`; every state is mapped, so this never returns
 * undefined.
 */
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

	/** Report a conflict: our update did not apply and the row is still survey-pending, so nothing valid happened. */
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
	/**
	 * Report success for the same interview, or swap in a new one while the survey is still untouched.
	 *
	 * A repeat call naming the interview that is already pinned is reported as resumed. A different
	 * interview is only allowed while no approved revision and no bootstrap data exist yet; the
	 * conditional update enforces that, so a second request racing the same swap changes zero rows and
	 * is re-read instead.
	 */
	async startSurvey(context: UserOnboardingSurveyStartContext): Promise<UserOnboardingTransitionResult>
	{
		if (context.onboarding.personaInterviewId === context.interviewId) return _Resumed(context.onboarding);
		if (context.onboarding.personaInterviewId === null) return _Denied(UserOnboardingDenialReasons.StateConflict, context.onboarding);
		const advanced = await context.repository.replaceSurveyInterview(context.owner, context.onboarding.personaInterviewId, context.interviewId);
		return _SurveyWriteResult(context.repository, context.owner, context.interviewId, advanced);
	}

	/**
	 * Decide what to report after our update did not apply and the row is now survey-in-progress.
	 *
	 * If the request that got there first pinned the same interview we wanted, the caller got what it
	 * asked for: report resumed. If it pinned a different interview, report an interview conflict so
	 * the client sends the user back to the survey that is actually running.
	 */
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

	/**
	 * Decide what to report after our approval update did not apply and the row is now bootstrap-chat-pending.
	 *
	 * If the stored interview and revision are exactly the ones we tried to pin, another request
	 * already did our work: report resumed. Anything else is a later persona change arriving after the
	 * survey closed - accepted, but it must not move the workflow, so report no-op.
	 */
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
