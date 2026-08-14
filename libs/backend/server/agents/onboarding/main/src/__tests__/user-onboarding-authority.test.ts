import { describe, expect, it } from "vitest";

import { __UserOnboardingAuthority } from "../user-onboarding-authority";
import { UserOnboardingBootstrapArchetypes, UserOnboardingDenialReasons, UserOnboardingPersonaColours, UserOnboardingStates, UserOnboardingTransitionStatuses } from "../user-onboarding.enums";
import { UserOnboardingPersonaWorkflowCoordinator } from "../user-onboarding.http";
import type { ApprovedPersonaEvidence, UserOnboardingOwner, UserOnboardingPersonaEvidencePort, UserOnboardingRecord, UserOnboardingRepository } from "../user-onboarding.types";

/** Stable authenticated owner used by the authority tests. */
const _OWNER: UserOnboardingOwner = { siloId: "silo-a", subjectId: "subject-a" };

/** In-memory onboarding repository that preserves the production transition guards. */
class _FakeUserOnboardingRepository implements UserOnboardingRepository
{
	/** Current durable workflow row. */
	private onboarding: UserOnboardingRecord | null;

	/** Create a repository with optional already-durable workflow state. */
	constructor(onboarding: UserOnboardingRecord | null = null)
	{
		this.onboarding = onboarding;
	}

	/** Return the pinned workflow or create the requested version once. */
	async ensure(owner: UserOnboardingOwner, currentWorkflowVersion: number): Promise<UserOnboardingRecord>
	{
		if (this.onboarding === null) this.onboarding = _Record(owner, currentWorkflowVersion);
		return this.onboarding;
	}

	/** Return the current owner-bound workflow. */
	async read(owner: UserOnboardingOwner): Promise<UserOnboardingRecord | null>
	{
		if (this.onboarding === null) return null;
		return this.onboarding.siloId === owner.siloId && this.onboarding.subjectId === owner.subjectId ? this.onboarding : null;
	}

	/** Enter survey-in-progress only from the survey states and exact pinned interview. */
	async markSurveyInProgress(owner: UserOnboardingOwner, interviewId: string): Promise<boolean>
	{
		const onboarding = await this.read(owner);
		if (onboarding === null) return false;
		if (onboarding.state !== UserOnboardingStates.SurveyPending && onboarding.state !== UserOnboardingStates.SurveyInProgress) return false;
		if (onboarding.personaInterviewId !== null && onboarding.personaInterviewId !== interviewId) return false;
		this.onboarding = { ...onboarding, state: UserOnboardingStates.SurveyInProgress, personaInterviewId: interviewId, surveyStartedAt: onboarding.surveyStartedAt ?? new Date("2026-08-08T10:01:00.000Z") };
		return true;
	}

	/** CAS-replace only the expected interview while the initial survey is active. */
	async replaceSurveyInterview(owner: UserOnboardingOwner, expectedInterviewId: string, replacementInterviewId: string): Promise<boolean>
	{
		const onboarding = await this.read(owner);
		if (onboarding === null || onboarding.state !== UserOnboardingStates.SurveyInProgress || onboarding.personaInterviewId !== expectedInterviewId || onboarding.personaRevisionId !== null) return false;
		this.onboarding = { ...onboarding, personaInterviewId: replacementInterviewId };
		return true;
	}

	/** Enter bootstrap-chat-pending only from the exact in-progress interview. */
	async markPersonaApproved(owner: UserOnboardingOwner, evidence: ApprovedPersonaEvidence): Promise<boolean>
	{
		const onboarding = await this.read(owner);
		if (onboarding === null || onboarding.state !== UserOnboardingStates.SurveyInProgress || onboarding.personaInterviewId !== evidence.interviewId || onboarding.personaRevisionId !== null) return false;
		this.onboarding = { ...onboarding, state: UserOnboardingStates.BootstrapChatPending, personaRevisionId: evidence.personaRevisionId };
		return true;
	}
}

/** Configurable persona evidence authority used to prove owner-bound fail-closed behaviour. */
class _FakePersonaEvidence implements UserOnboardingPersonaEvidencePort
{
	/** Interview identifiers owned by the test owner. */
	readonly ownedInterviewIds: readonly string[];

	/** Exact approved revision indexed by its source interview. */
	readonly approvedRevisions: Readonly<Record<string, string>>;

	/** Create exact test evidence. */
	constructor(ownedInterviewIds: readonly string[], approvedRevisions: Readonly<Record<string, string>>)
	{
		this.ownedInterviewIds = ownedInterviewIds;
		this.approvedRevisions = approvedRevisions;
	}

	/** Confirm only the configured owner and interview. */
	async ownsInterview(owner: UserOnboardingOwner, interviewId: string): Promise<boolean>
	{
		return owner.siloId === _OWNER.siloId && owner.subjectId === _OWNER.subjectId && this.ownedInterviewIds.includes(interviewId);
	}

	/** Return only the exact configured owner, interview, and approved revision. */
	async readApprovedPersona(owner: UserOnboardingOwner, evidence: ApprovedPersonaEvidence): Promise<ApprovedPersonaEvidence | null>
	{
		if (!await this.ownsInterview(owner, evidence.interviewId) || evidence.personaRevisionId !== this.approvedRevisions[evidence.interviewId]) return null;
		return evidence;
	}

	/** Return the configured approved revision for the exact owner-bound interview. */
	async readLatestApprovedPersona(owner: UserOnboardingOwner, interviewId: string): Promise<ApprovedPersonaEvidence | null>
	{
		const personaRevisionId = this.approvedRevisions[interviewId];
		if (!await this.ownsInterview(owner, interviewId) || personaRevisionId === undefined) return null;
		return { interviewId, personaRevisionId };
	}

	/** Return safe bootstrap display evidence for one configured approved revision. */
	async readApprovedBootstrapEvidence(owner: UserOnboardingOwner, personaRevisionId: string)
	{
		if (owner.siloId !== _OWNER.siloId || owner.subjectId !== _OWNER.subjectId || !Object.values(this.approvedRevisions).includes(personaRevisionId)) return null;
		return { personaRevisionId, displayName: "The Commander", archetype: UserOnboardingBootstrapArchetypes.Commander, primaryColour: UserOnboardingPersonaColours.Red };
	}
}

/** Build one new onboarding authority over isolated fake ports. */
function _Authority(repository: UserOnboardingRepository, approvedRevisionId: string | null = "revision-a"): __UserOnboardingAuthority
{
	const revisions: Readonly<Record<string, string>> = approvedRevisionId === null ? {} : { "interview-a": approvedRevisionId };
	return new __UserOnboardingAuthority(repository, new _FakePersonaEvidence(["interview-a"], revisions), 3);
}

/** Build a deterministic survey-pending workflow projection. */
function _Record(owner: UserOnboardingOwner, workflowVersion: number): UserOnboardingRecord
{
	const startedAt = new Date("2026-08-08T10:00:00.000Z");
	return {
		id: "onboarding-a",
		siloId: owner.siloId,
		subjectId: owner.subjectId,
		workflowVersion,
		state: UserOnboardingStates.SurveyPending,
		personaInterviewId: null,
		personaRevisionId: null,
		bootstrapConversationId: null,
		bootstrapContentRevisionId: null,
		bootstrapContentDigest: null,
		completionProvenance: null,
		completionMigrationRevision: null,
		completionMigrationBatch: null,
		startedAt,
		surveyStartedAt: null,
		completedAt: null,
		updatedAt: startedAt,
	};
}

describe("__UserOnboardingAuthority", function _UserOnboardingAuthoritySuite()
{
	it("creates one pinned survey-pending workflow for the session-derived owner", async function _CreatesPendingWorkflow()
	{
		const repository = new _FakeUserOnboardingRepository();
		const authority = _Authority(repository);

		const first = await authority.readOrCreate(_OWNER);
		const resumed = await authority.readOrCreate(_OWNER);

		expect(first).toMatchObject({ workflowVersion: 3, state: UserOnboardingStates.SurveyPending, siloId: _OWNER.siloId, subjectId: _OWNER.subjectId });
		expect(resumed.id).toBe(first.id);
	});

	it("starts and idempotently resumes the exact owner-bound survey interview", async function _StartsAndResumesSurvey()
	{
		const repository = new _FakeUserOnboardingRepository();
		const authority = _Authority(repository);

		const started = await authority.startSurvey(_OWNER, "interview-a");
		const resumed = await authority.startSurvey(_OWNER, "interview-a");

		expect(started).toMatchObject({ status: UserOnboardingTransitionStatuses.Advanced, onboarding: { state: UserOnboardingStates.SurveyInProgress, personaInterviewId: "interview-a" } });
		expect(resumed).toMatchObject({ status: UserOnboardingTransitionStatuses.Resumed, onboarding: { personaInterviewId: "interview-a" } });
	});

	it("reconciles an interrupted approval before observing a newer persona interview", async function _ReconcilesBeforeRestart()
	{
		const inProgress = { ..._Record(_OWNER, 3), state: UserOnboardingStates.SurveyInProgress, personaInterviewId: "interview-a", surveyStartedAt: new Date("2026-08-08T10:01:00.000Z") };
		const repository = new _FakeUserOnboardingRepository(inProgress);
		const evidence = new _FakePersonaEvidence(["interview-a", "interview-b"], { "interview-a": "revision-a" });
		const coordinator = new UserOnboardingPersonaWorkflowCoordinator(new __UserOnboardingAuthority(repository, evidence, 3));

		await coordinator.surveyStarted(_OWNER, "interview-b");

		expect(await repository.read(_OWNER)).toMatchObject({ state: UserOnboardingStates.BootstrapChatPending, personaInterviewId: "interview-a", personaRevisionId: "revision-a" });
	});

	it("denies a foreign interview without creating browser-selected authority", async function _DeniesForeignInterview()
	{
		const repository = new _FakeUserOnboardingRepository();
		const result = await _Authority(repository).startSurvey(_OWNER, "interview-b");

		expect(result).toEqual({ status: UserOnboardingTransitionStatuses.Denied, reason: UserOnboardingDenialReasons.InterviewNotOwned, onboarding: null });
		expect(await repository.read(_OWNER)).toBeNull();
	});

	it("CAS-replaces the pinned interview when the owner deliberately sorts again", async function _ReplacesInitialInterview()
	{
		const repository = new _FakeUserOnboardingRepository();
		const evidence = new _FakePersonaEvidence(["interview-a", "interview-b"], { "interview-b": "revision-b" });
		const authority = new __UserOnboardingAuthority(repository, evidence, 3);
		await authority.startSurvey(_OWNER, "interview-a");

		const replaced = await authority.startSurvey(_OWNER, "interview-b");
		const approved = await authority.recordApprovedPersona(_OWNER, { interviewId: "interview-b", personaRevisionId: "revision-b" });

		expect(replaced).toMatchObject({ status: UserOnboardingTransitionStatuses.Advanced, onboarding: { workflowVersion: 3, personaInterviewId: "interview-b" } });
		expect(approved).toMatchObject({ status: UserOnboardingTransitionStatuses.Advanced, onboarding: { state: UserOnboardingStates.BootstrapChatPending, personaInterviewId: "interview-b", personaRevisionId: "revision-b" } });
	});

	it.each([UserOnboardingStates.BootstrapChatPending, UserOnboardingStates.BootstrapChatInProgress, UserOnboardingStates.Completed])("accepts a verified persona refresh without regressing %s", async function _DoesNotRegressLaterWorkflow(state)
	{
		const durable = { ..._Record(_OWNER, 3), state, personaInterviewId: "interview-a", personaRevisionId: "revision-a", surveyStartedAt: new Date("2026-08-08T10:01:00.000Z") };
		const repository = new _FakeUserOnboardingRepository(durable);
		const evidence = new _FakePersonaEvidence(["interview-a", "interview-b"], { "interview-a": "revision-a", "interview-b": "revision-b" });
		const authority = new __UserOnboardingAuthority(repository, evidence, 3);

		const sortedAgain = await authority.startSurvey(_OWNER, "interview-b");
		const refreshed = await authority.recordApprovedPersona(_OWNER, { interviewId: "interview-b", personaRevisionId: "revision-b" });

		expect(sortedAgain).toMatchObject({ status: UserOnboardingTransitionStatuses.NoOp, onboarding: { state, personaInterviewId: "interview-a", personaRevisionId: "revision-a" } });
		expect(refreshed).toMatchObject({ status: UserOnboardingTransitionStatuses.NoOp, onboarding: { state, personaInterviewId: "interview-a", personaRevisionId: "revision-a" } });
	});

	it("advances only after the persona authority confirms the exact approved revision", async function _PinsApprovedPersona()
	{
		const repository = new _FakeUserOnboardingRepository();
		const authority = _Authority(repository);
		await authority.startSurvey(_OWNER, "interview-a");

		const approved = await authority.recordApprovedPersona(_OWNER, { interviewId: "interview-a", personaRevisionId: "revision-a" });
		const resumed = await authority.recordApprovedPersona(_OWNER, { interviewId: "interview-a", personaRevisionId: "revision-a" });

		expect(approved).toMatchObject({ status: UserOnboardingTransitionStatuses.Advanced, onboarding: { state: UserOnboardingStates.BootstrapChatPending, personaInterviewId: "interview-a", personaRevisionId: "revision-a" } });
		expect(resumed).toMatchObject({ status: UserOnboardingTransitionStatuses.Resumed, onboarding: { state: UserOnboardingStates.BootstrapChatPending } });
	});

	it("recovers a persona approval whose workflow notification was interrupted", async function _RecoversCommittedApproval()
	{
		const repository = new _FakeUserOnboardingRepository();
		const withoutApproval = _Authority(repository, null);
		await withoutApproval.startSurvey(_OWNER, "interview-a");

		const reconciled = await _Authority(repository, "revision-a").readOrCreate(_OWNER);

		expect(reconciled).toMatchObject({ state: UserOnboardingStates.BootstrapChatPending, personaInterviewId: "interview-a", personaRevisionId: "revision-a" });
	});

	it("keeps the survey durable when approval evidence is absent", async function _DeniesUnapprovedPersona()
	{
		const repository = new _FakeUserOnboardingRepository();
		const authority = _Authority(repository, null);
		await authority.startSurvey(_OWNER, "interview-a");

		const result = await authority.recordApprovedPersona(_OWNER, { interviewId: "interview-a", personaRevisionId: "revision-a" });

		expect(result).toMatchObject({ status: UserOnboardingTransitionStatuses.Denied, reason: UserOnboardingDenialReasons.PersonaNotApproved, onboarding: { state: UserOnboardingStates.SurveyInProgress, personaRevisionId: null } });
	});
});
