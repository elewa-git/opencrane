import { ___DoWithTrace } from "@opencrane/backend/observability";

import { UserOnboardingDenialReasons, UserOnboardingStates, UserOnboardingTransitionStatuses } from "./user-onboarding.enums.js";
import type { ApprovedPersonaEvidence, UserOnboardingOwner, UserOnboardingPersonaEvidencePort, UserOnboardingRecord, UserOnboardingRepository, UserOnboardingTransitionResult } from "./user-onboarding.types.js";

/** Server-owned orchestration for the resumable persona-survey phase of onboarding. */
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
			const existingResult = _ApprovedResumeOrConflict(before, evidence);
			if (existingResult !== null) return existingResult;
			if (before.state !== UserOnboardingStates.SurveyInProgress) return _Denied(UserOnboardingDenialReasons.StateConflict, before);
			if (before.personaInterviewId !== evidence.interviewId) return _Denied(UserOnboardingDenialReasons.InterviewConflict, before);
			const advanced = await self.repository.markPersonaApproved(owner, evidence);
			const after = await self.repository.read(owner);
			if (advanced && after !== null) return { status: UserOnboardingTransitionStatuses.Advanced, onboarding: after };
			return _ApprovedResumeOrConflict(after, evidence) ?? _Denied(UserOnboardingDenialReasons.StateConflict, after);
		});
	}

	/** Verify interview ownership, pin it, and recover deterministically across duplicate calls. */
	private async _markSurveyInProgress(owner: UserOnboardingOwner, interviewId: string): Promise<UserOnboardingTransitionResult>
	{
		// 1. Revalidate the persona-owned interview before accepting any workflow notification.
		if (!_Present(interviewId)) return _Denied(UserOnboardingDenialReasons.InvalidReference, await this.repository.read(owner));
		if (!await this.personaEvidence.ownsInterview(owner, interviewId)) return _Denied(UserOnboardingDenialReasons.InterviewNotOwned, await this.repository.read(owner));
		const before = await this.repository.ensure(owner, this.currentWorkflowVersion);

		// 2. Persona maintenance after the initial survey is deliberately outside this workflow.
		if (_BeyondInitialSurvey(before.state)) return { status: UserOnboardingTransitionStatuses.NoOp, onboarding: before };
		if (before.state === UserOnboardingStates.SurveyInProgress && before.personaInterviewId === interviewId) return { status: UserOnboardingTransitionStatuses.Resumed, onboarding: before };

		// 3. Start the first survey or CAS-replace only its expected interview during an intentional re-sort.
		let advanced = false;
		if (before.state === UserOnboardingStates.SurveyPending && before.personaInterviewId === null)
		{
			advanced = await this.repository.markSurveyInProgress(owner, interviewId);
		}
		else if (before.state === UserOnboardingStates.SurveyInProgress && before.personaInterviewId !== null)
		{
			advanced = await this.repository.replaceSurveyInterview(owner, before.personaInterviewId, interviewId);
		}
		else
		{
			return _Denied(UserOnboardingDenialReasons.StateConflict, before);
		}

		// 4. Re-read after the CAS so retries recover the exact durable winner without regressing state.
		const after = await this.repository.read(owner);
		if (advanced && after !== null) return { status: UserOnboardingTransitionStatuses.Advanced, onboarding: after };
		if (after?.state === UserOnboardingStates.SurveyInProgress && after.personaInterviewId === interviewId) return { status: UserOnboardingTransitionStatuses.Resumed, onboarding: after };
		if (after !== null && _BeyondInitialSurvey(after.state)) return { status: UserOnboardingTransitionStatuses.NoOp, onboarding: after };
		return _Denied(_SurveyConflictReason(after, interviewId), after);
	}

	/** Recover a committed persona approval when its post-commit workflow notification was interrupted. */
	private async _reconcileApprovedPersona(owner: UserOnboardingOwner, onboarding: UserOnboardingRecord): Promise<UserOnboardingRecord>
	{
		if (onboarding.state !== UserOnboardingStates.SurveyInProgress || onboarding.personaInterviewId === null) return onboarding;
		const approved = await this.personaEvidence.readLatestApprovedPersona(owner, onboarding.personaInterviewId);
		if (approved === null || approved.interviewId !== onboarding.personaInterviewId) return onboarding;
		await this.repository.markPersonaApproved(owner, approved);
		return await this.repository.read(owner) ?? onboarding;
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

/** Recognise an idempotent approved result or an already-advanced conflict. */
function _ApprovedResumeOrConflict(onboarding: UserOnboardingRecord | null, evidence: ApprovedPersonaEvidence): UserOnboardingTransitionResult | null
{
	if (onboarding === null) return null;
	if (onboarding.state === UserOnboardingStates.BootstrapChatPending && onboarding.personaInterviewId === evidence.interviewId && onboarding.personaRevisionId === evidence.personaRevisionId) return { status: UserOnboardingTransitionStatuses.Resumed, onboarding };
	if (_BeyondInitialSurvey(onboarding.state)) return { status: UserOnboardingTransitionStatuses.NoOp, onboarding };
	return null;
}

/** Return whether initial survey provenance is already frozen behind a later workflow state. */
function _BeyondInitialSurvey(state: UserOnboardingStates): boolean
{
	return state === UserOnboardingStates.BootstrapChatPending || state === UserOnboardingStates.BootstrapChatInProgress || state === UserOnboardingStates.Completed;
}

/** Explain a failed survey update from the durable row observed after the race. */
function _SurveyConflictReason(onboarding: UserOnboardingRecord | null, interviewId: string): UserOnboardingDenialReasons
{
	if (onboarding !== null && onboarding.personaInterviewId !== null && onboarding.personaInterviewId !== interviewId) return UserOnboardingDenialReasons.InterviewConflict;
	return UserOnboardingDenialReasons.StateConflict;
}
