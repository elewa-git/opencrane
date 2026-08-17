import { describe, expect, it, vi } from "vitest";

import { __UserOnboardingCompletion } from "../user-onboarding-completion";
import { UserOnboardingCompletionProvenances, UserOnboardingStates } from "../user-onboarding.enums";
import { UserOnboardingPersonalAgentBootstrapStatuses, UserOnboardingReadinessStatuses, type UserOnboardingCompletionEvidence, type UserOnboardingCompletionRepository, type UserOnboardingPersonalAgentBootstrapPort, type UserOnboardingPersonalAgentBootstrapResult } from "../user-onboarding-completion.types";
import type { UserOnboardingOwner } from "../user-onboarding.types";

/** Stable owner supplied by an authenticated test session. */
const _OWNER: UserOnboardingOwner = { siloId: "silo-1", subjectId: "user-1" };

/** Build exact three-answer evidence with optional state overrides. */
function _Evidence(overrides: Partial<UserOnboardingCompletionEvidence> = {}): UserOnboardingCompletionEvidence
{
	return {
		onboardingId: "onboarding-1",
		siloId: _OWNER.siloId,
		subjectId: _OWNER.subjectId,
		state: UserOnboardingStates.BootstrapChatInProgress,
		completionProvenance: null,
		conversationId: "conversation-1",
		personaRevisionId: "persona-1",
		bootstrapPinsMatch: true,
		questionCount: 3,
		answeredQuestionOrdinals: [1, 2, 3],
		...overrides,
	};
}

/** Build onboarding persistence over one evidence result. */
function _Repository(evidence: UserOnboardingCompletionEvidence | null)
{
	const markCompleted = vi.fn().mockResolvedValue(true);
	const repository: UserOnboardingCompletionRepository = { readEvidence: vi.fn().mockResolvedValue(evidence), markCompleted };
	return { repository, markCompleted };
}

/** Build an agent-services bootstrap port that is ready unless overridden. */
function _PersonalAgent(result: UserOnboardingPersonalAgentBootstrapResult = { status: UserOnboardingPersonalAgentBootstrapStatuses.Ready, agentServiceId: "onboarding-1" })
{
	const ensureReady = vi.fn().mockResolvedValue(result);
	return { repository: { ensureReady } as UserOnboardingPersonalAgentBootstrapPort, ensureReady };
}

describe("__UserOnboardingCompletion", function _UserOnboardingCompletionSuite()
{
	it("creates the personal Agent before marking onboarding completed", async function _CompletesAfterAgentReadiness()
	{
		const onboarding = _Repository(_Evidence());
		const personalAgent = _PersonalAgent();
		const completedAt = new Date("2026-08-17T08:30:00.000Z");

		await expect(new __UserOnboardingCompletion(onboarding.repository, personalAgent.repository).complete(_OWNER, "conversation-1", completedAt)).resolves.toEqual({ status: UserOnboardingReadinessStatuses.Ready, agentServiceId: "onboarding-1" });
		expect(personalAgent.ensureReady).toHaveBeenCalledWith({ onboardingId: "onboarding-1", siloId: "silo-1", subjectId: "user-1", onboardingPersonaRevisionId: "persona-1", readinessKind: "completion", provisionedAt: completedAt });
		expect(onboarding.markCompleted).toHaveBeenCalledWith(_OWNER, "conversation-1", completedAt);
		expect(personalAgent.ensureReady.mock.invocationCallOrder[0]).toBeLessThan(onboarding.markCompleted.mock.invocationCallOrder[0] ?? 0);
	});

	it("does not complete onboarding when personal Agent authority denies bootstrap", async function _RollsBackDeniedAgent()
	{
		const onboarding = _Repository(_Evidence());
		const personalAgent = _PersonalAgent({ status: UserOnboardingPersonalAgentBootstrapStatuses.Denied });

		await expect(new __UserOnboardingCompletion(onboarding.repository, personalAgent.repository).complete(_OWNER, "conversation-1", new Date())).resolves.toEqual({ status: UserOnboardingReadinessStatuses.AuthorityUnavailable, agentServiceId: null });
		expect(onboarding.markCompleted).not.toHaveBeenCalled();
	});

	it.each([
		{ conversationId: "other" },
		{ bootstrapPinsMatch: false },
		{ questionCount: 2 },
		{ answeredQuestionOrdinals: [1, 3, 2] },
		{ personaRevisionId: null },
	])("refuses incomplete or mismatched bootstrap evidence %#", async function _RejectsInvalidEvidence(overrides)
	{
		const onboarding = _Repository(_Evidence(overrides));
		const personalAgent = _PersonalAgent();

		await expect(new __UserOnboardingCompletion(onboarding.repository, personalAgent.repository).complete(_OWNER, "conversation-1", new Date())).resolves.toEqual({ status: UserOnboardingReadinessStatuses.OnboardingRequired, agentServiceId: null });
		expect(personalAgent.ensureReady).not.toHaveBeenCalled();
		expect(onboarding.markCompleted).not.toHaveBeenCalled();
	});

	it("repairs a completed bootstrap-concluded owner without rewriting onboarding", async function _RepairsCompletedOwner()
	{
		const onboarding = _Repository(_Evidence({ state: UserOnboardingStates.Completed, completionProvenance: UserOnboardingCompletionProvenances.BootstrapConcluded }));
		const personalAgent = _PersonalAgent({ status: UserOnboardingPersonalAgentBootstrapStatuses.Ready, agentServiceId: "onboarding-1" });

		const observedAt = new Date("2026-08-17T09:00:00.000Z");
		await expect(new __UserOnboardingCompletion(onboarding.repository, personalAgent.repository).ensureReady(_OWNER, observedAt)).resolves.toEqual({ status: UserOnboardingReadinessStatuses.Ready, agentServiceId: "onboarding-1" });
		expect(personalAgent.ensureReady).toHaveBeenCalledWith({ onboardingId: "onboarding-1", siloId: "silo-1", subjectId: "user-1", onboardingPersonaRevisionId: "persona-1", readinessKind: "repair", provisionedAt: observedAt });
		expect(onboarding.markCompleted).not.toHaveBeenCalled();
	});

	it("does not fabricate personal Agent evidence for migration-completed owners", async function _LeavesMigratedOwnerAlone()
	{
		const onboarding = _Repository(_Evidence({ state: UserOnboardingStates.Completed, completionProvenance: UserOnboardingCompletionProvenances.ExistingUserMigration, conversationId: null, personaRevisionId: null, bootstrapPinsMatch: false, questionCount: 0, answeredQuestionOrdinals: [] }));
		const personalAgent = _PersonalAgent();

		await expect(new __UserOnboardingCompletion(onboarding.repository, personalAgent.repository).ensureReady(_OWNER, new Date())).resolves.toEqual({ status: UserOnboardingReadinessStatuses.NotApplicable, agentServiceId: null });
		expect(personalAgent.ensureReady).not.toHaveBeenCalled();
	});
});
