import { ___DoWithTrace } from "@opencrane/backend/observability";

import { UserOnboardingDenialReasons, UserOnboardingTransitionStatuses } from "./user-onboarding.enums";
import { _UserOnboardingLifecycleState } from "./user-onboarding-lifecycle-state";
import type { ApprovedPersonaEvidence, UserOnboardingOwner, UserOnboardingPersonaEvidencePort, UserOnboardingRecord, UserOnboardingRepository, UserOnboardingTransitionResult } from "./user-onboarding.types";

/**
 * Runs the persona-survey half of onboarding: start or resume a survey, then pin the approved persona.
 *
 * Every method re-checks with the persona package before writing, dispatches through the state
 * object for the row's current state, and reports a stable status instead of throwing when a race is
 * lost - so any call here can be retried safely. `readOrCreate` also repairs one specific gap: if
 * persona committed an approval but its notification to onboarding never arrived (a crash or a
 * dropped call), reading the row finds that approval and pins it.
 *
 * Called by: __CreateUserOnboardingRouter and __UserOnboardingChatAuthority in this package, and
 * UserOnboardingPersonaWorkflowCoordinator; constructed in
 * apps/opencrane/src/app/user-onboarding-composition.ts.
 *
 * @see {@link UserOnboardingTransitionResult} for what the write methods report.
 */
export class __UserOnboardingAuthority
{
	/** Persistence authority for UserOnboarding rows only. */
	private readonly repository: UserOnboardingRepository;

	/** Persona-owned evidence reader; onboarding never reads persona tables itself. */
	private readonly personaEvidence: UserOnboardingPersonaEvidencePort;

	/** Workflow version pinned only when a new owner record is created. */
	private readonly currentWorkflowVersion: number;

	/** Compose onboarding from owner-bound persistence and persona evidence ports. */
	constructor(repository: UserOnboardingRepository, personaEvidence: UserOnboardingPersonaEvidencePort, currentWorkflowVersion: number)
	{
		if (!Number.isSafeInteger(currentWorkflowVersion) || currentWorkflowVersion < 1) throw new Error("currentWorkflowVersion must be a positive safe integer");
		this.repository = repository;
		this.personaEvidence = personaEvidence;
		this.currentWorkflowVersion = currentWorkflowVersion;
	}

	/** Read the session owner's authoritative route state, creating survey-pending when absent. */
	async readOrCreate(owner: UserOnboardingOwner): Promise<UserOnboardingRecord>
	{
		const self = this;
		return ___DoWithTrace("user_onboarding.read_or_create", _TraceOwner(owner), async function _ReadOrCreate()
		{
			const onboarding = await self.repository.ensure(owner, self.currentWorkflowVersion);
			return self._reconcileApprovedPersona(owner, onboarding);
		});
	}

	/** Pin the exact owner-verified persona interview and enter or resume the survey. */
	async startSurvey(owner: UserOnboardingOwner, interviewId: string): Promise<UserOnboardingTransitionResult>
	{
		const self = this;
		return ___DoWithTrace("user_onboarding.survey.start", _TraceOwner(owner), async function _StartSurvey()
		{
			return self._markSurveyInProgress(owner, interviewId);
		});
	}

	/** Verify and pin the exact approved persona revision before routing to bootstrap chat. */
	async recordApprovedPersona(owner: UserOnboardingOwner, evidence: ApprovedPersonaEvidence): Promise<UserOnboardingTransitionResult>
	{
		const self = this;
		return ___DoWithTrace("user_onboarding.persona.approved", _TraceOwner(owner), async function _RecordApprovedPersona()
		{
			if (!_Present(evidence.interviewId) || !_Present(evidence.personaRevisionId)) return _Denied(UserOnboardingDenialReasons.InvalidReference, await self.repository.read(owner));
			const approved = await self.personaEvidence.readApprovedPersona(owner, evidence);
			if (approved === null || approved.interviewId !== evidence.interviewId || approved.personaRevisionId !== evidence.personaRevisionId) return _Denied(UserOnboardingDenialReasons.PersonaNotApproved, await self.repository.read(owner));
			const before = await self.repository.read(owner);
			if (before === null) return _Denied(UserOnboardingDenialReasons.StateConflict, null);
			return _UserOnboardingLifecycleState(before).recordPersonaApproved({ repository: self.repository, owner, onboarding: before, evidence });
		});
	}

	/** Verify interview ownership, pin it, and recover deterministically across duplicate calls. */
	private async _markSurveyInProgress(owner: UserOnboardingOwner, interviewId: string): Promise<UserOnboardingTransitionResult>
	{
		// 1. Revalidate the persona-owned interview before accepting any workflow notification.
		if (!_Present(interviewId)) return _Denied(UserOnboardingDenialReasons.InvalidReference, await this.repository.read(owner));
		if (!await this.personaEvidence.ownsInterview(owner, interviewId)) return _Denied(UserOnboardingDenialReasons.InterviewNotOwned, await this.repository.read(owner));
		const before = await this.repository.ensure(owner, this.currentWorkflowVersion);

		// 2. State dispatch keeps the initial-survey lifecycle exhaustive while each state retains its CAS semantics.
		return _UserOnboardingLifecycleState(before).startSurvey({ repository: this.repository, owner, onboarding: before, interviewId });
	}

	/** Recover a committed persona approval when its post-commit workflow notification was interrupted. */
	private async _reconcileApprovedPersona(owner: UserOnboardingOwner, onboarding: UserOnboardingRecord): Promise<UserOnboardingRecord>
	{
		return _UserOnboardingLifecycleState(onboarding).reconcilePersonaApproval({ repository: this.repository, personaEvidence: this.personaEvidence, owner, onboarding });
	}
}

/** Return true only for a non-empty durable reference. */
function _Present(value: string): boolean
{
	return value.trim().length > 0;
}

/** Keep trace fields owner-bound and free of persona or bootstrap content. */
function _TraceOwner(owner: UserOnboardingOwner): Record<string, unknown>
{
	return { siloId: owner.siloId, subjectId: owner.subjectId };
}

/** Build one fail-closed transition denial. */
function _Denied(reason: UserOnboardingDenialReasons, onboarding: UserOnboardingRecord | null): UserOnboardingTransitionResult
{
	return { status: UserOnboardingTransitionStatuses.Denied, reason, onboarding };
}
