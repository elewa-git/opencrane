import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";

import { PersonaLifecycleOutcomes } from "../../profile/persona-lifecycle.types";
import { __CompletePersonaInterview, __RecordPersonaInterviewAnswer, __StartPersonaInterview } from "../persona-interview-authority";
import type { PersonaInterviewRepository } from "../persona-interview-authority.types";
import { PrismaPersonaInterviewRepository } from "../prisma-persona-interview-repository";
import { PersonaColourValues, PersonaModifierValues } from "../../scoring/persona-scorer.types";

/** Fully resolved score used by lifecycle fakes. */
const _SCORE = { orderedAnswerIds: ["answer-1"], orderedChoiceIds: ["q1:a"], colours: { red: 1, yellow: 0, green: 0, blue: 1, total: 2 }, openness: { explorer: 1, guardian: 0, total: 1 }, tieResolutions: [], primary: PersonaColourValues.Red, secondary: PersonaColourValues.Blue, modifier: PersonaModifierValues.Explorer, resolutionRequired: null } as const;

/** Creates a repository that records lifecycle calls without using a database. */
function _repository(overrides: Partial<PersonaInterviewRepository> = {}): PersonaInterviewRepository
{
	return {
		startAtomically: async function _start() { return { status: PersonaLifecycleOutcomes.Started, interviewId: "interview-1" } as const; },
		recordAnswerAtomically: async function _record() { return { status: PersonaLifecycleOutcomes.Recorded, answerId: "answer-1" } as const; },
		completeAtomically: async function _complete() { return { status: PersonaLifecycleOutcomes.Completed, score: _SCORE } as const; },
		resolveTieAtomically: async function _resolve() { return { status: PersonaLifecycleOutcomes.Recorded, score: _SCORE } as const; },
		...overrides,
	};
}

/** Creates the valid exact reviewed-question-set request used by lifecycle tests. */
function _startCommand()
{
	return { siloId: "silo-1", userId: "user-1", personaProfileId: "profile-1", refreshConfigurationChangeId: null, questionSetId: "onboarding", questionSetVersion: 1, scoringPolicyId: "policy", scoringPolicyVersion: 1, interpolationMapId: "map", interpolationMapVersion: 1, startedAt: "2026-07-23T09:00:00.000Z" } as const;
}

describe("persona interview authority", function _describePersonaInterviewAuthority()
{
	it("reuses an owner's active interview rather than starting a competing one", async function _reusesInProgress()
	{
		const startAtomically = vi.fn().mockResolvedValue({ status: "already_in_progress", interviewId: "interview-existing" });
		const result = await __StartPersonaInterview(_repository({ startAtomically }), _startCommand());

		expect(result).toEqual({ outcome: "already_in_progress", interviewId: "interview-existing" });
		expect(startAtomically).toHaveBeenCalledWith(_startCommand());
	});

	it("rejects a blank answer before it can reach the append-only repository", async function _rejectsBlankAnswer()
	{
		const recordAnswerAtomically = vi.fn();
		const result = await __RecordPersonaInterviewAnswer(_repository({ recordAnswerAtomically }), { userId: "user-1", personaProfileId: "profile-1", interviewId: "interview-1", questionId: "q1", choiceId: " ", answeredAt: "2026-07-23T09:01:00.000Z" });

		expect(result).toEqual({ outcome: "denied", reason: "invalid_command" });
		expect(recordAnswerAtomically).not.toHaveBeenCalled();
	});

	it("preserves the incomplete-evidence denial returned by the atomic completion fence", async function _preservesCompletionDenial()
	{
		const completeAtomically = vi.fn().mockResolvedValue({ status: "incomplete_answers" });
		const result = await __CompletePersonaInterview(_repository({ completeAtomically }), { userId: "user-1", personaProfileId: "profile-1", interviewId: "interview-1", completedAt: "2026-07-23T09:02:00.000Z" });

		expect(result).toEqual({ outcome: "denied", reason: "incomplete_answers" });
		expect(completeAtomically).toHaveBeenCalledOnce();
	});

	it("starts only after the profile and exact reviewed question-set revision are fenced", async function _startsExactReviewedSet()
	{
		const transaction = {
			personaProfile: { findFirst: vi.fn().mockResolvedValue({ siloId: "silo-1", activeRevisionId: null }) },
			personaInterview: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: "interview-created" }) },
			personaQuestionSet: { findUnique: vi.fn().mockResolvedValue({ state: "Reviewed" }) },
			personaScoringPolicy: { findUnique: vi.fn().mockResolvedValue({ id: "policy" }) },
			personaInterpolationMap: { findUnique: vi.fn().mockResolvedValue({ id: "map" }) },
		};
		const repository = new PrismaPersonaInterviewRepository(transaction as unknown as Prisma.TransactionClient);

		await expect(repository.startAtomically(_startCommand())).resolves.toEqual({ status: "started", interviewId: "interview-created" });
		expect(transaction.personaQuestionSet.findUnique).toHaveBeenCalledWith({ where: { id_version: { id: "onboarding", version: 1 } }, select: { state: true } });
		expect(transaction.personaInterview.create).toHaveBeenCalledWith({ data: expect.objectContaining({ personaProfileId: "profile-1", userId: "user-1", questionSetId: "onboarding", questionSetVersion: 1 }), select: { id: true } });
	});

	it("replays the same proposal-bound refresh interview after a lost start response", async function _ReplaysRefreshStart()
	{
		const transaction = {
			personaProfile: { findFirst: vi.fn().mockResolvedValue({ siloId: "silo-1", activeRevisionId: null }) },
			personaInterview: { findFirst: vi.fn().mockResolvedValue({ id: "interview-existing", refreshConfigurationChangeId: "change-1" }), create: vi.fn() },
			personaQuestionSet: { findUnique: vi.fn() },
			personalConfigurationChange: { findFirst: vi.fn().mockResolvedValue({ id: "change-1" }) },
		};
		const repository = new PrismaPersonaInterviewRepository(transaction as unknown as Prisma.TransactionClient);

		await expect(repository.startAtomically({ ..._startCommand(), refreshConfigurationChangeId: "change-1" })).resolves.toEqual({ status: "already_in_progress", interviewId: "interview-existing" });
		expect(transaction.personaInterview.create).not.toHaveBeenCalled();
		expect(transaction.personaQuestionSet.findUnique).not.toHaveBeenCalled();
	});

	it("appends an answer only while the owner interview is still in progress", async function _appendsWhileInProgress()
	{
		const transaction = {
			personaInterview: { findFirst: vi.fn().mockResolvedValue({ questionSetId: "onboarding", questionSetVersion: 1, state: "InProgress" }) },
			personaQuestionChoice: { findUnique: vi.fn().mockResolvedValue({ id: "a" }) },
			personaInterviewAnswer: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: "answer-created" }) },
		};
		const repository = new PrismaPersonaInterviewRepository(transaction as unknown as Prisma.TransactionClient);

		await expect(repository.recordAnswerAtomically({ userId: "user-1", personaProfileId: "profile-1", interviewId: "interview-1", questionId: "q1", choiceId: "a", answeredAt: "2026-07-23T09:01:00.000Z" })).resolves.toEqual({ status: "recorded", answerId: "answer-created" });
		expect(transaction.personaInterviewAnswer.create).toHaveBeenCalledWith({ data: expect.objectContaining({ interviewId: "interview-1", questionSetId: "onboarding", questionSetVersion: 1, questionId: "q1" }), select: { id: true } });
	});

});
