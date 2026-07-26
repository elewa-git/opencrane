import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { __CompletePersonaInterview, __RecordPersonaInterviewAnswer, __StartPersonaInterview } from "../persona-interview-authority.js";
import type { PersonaInterviewRepository } from "../persona-interview-authority.types.js";
import { PrismaPersonaInterviewRepository } from "../prisma-persona-interview-repository.js";

/** Creates a repository that records lifecycle calls without using a database. */
function _repository(overrides: Partial<PersonaInterviewRepository> = {}): PersonaInterviewRepository
{
	return {
		startAtomically: async function _start() { return { status: "started", interviewId: "interview-1" } as const; },
		recordAnswerAtomically: async function _record() { return { status: "recorded", answerId: "answer-1" } as const; },
		completeAtomically: async function _complete() { return { status: "completed" } as const; },
		...overrides,
	};
}

/** Creates the valid exact reviewed-question-set request used by lifecycle tests. */
function _startCommand()
{
	return { siloId: "silo-1", userId: "user-1", personaProfileId: "profile-1", refreshConfigurationChangeId: null, questionSetId: "onboarding", questionSetVersion: 1, startedAt: "2026-07-23T09:00:00.000Z" } as const;
}

/** Wraps one fake transactional client in the narrow Prisma interface this authority needs. */
function _prisma(transaction: unknown): PrismaClient
{
	return { $transaction: async function _transaction(callback: (client: unknown) => Promise<unknown>) { return await callback(transaction); } } as unknown as PrismaClient;
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
		const result = await __RecordPersonaInterviewAnswer(_repository({ recordAnswerAtomically }), { userId: "user-1", personaProfileId: "profile-1", interviewId: "interview-1", questionId: "q1", value: " ", answeredAt: "2026-07-23T09:01:00.000Z" });

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
			$queryRaw: vi.fn().mockResolvedValue([{ id: "profile-1" }]),
			personaInterview: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: "interview-created" }) },
			personaQuestionSet: { findUnique: vi.fn().mockResolvedValue({ state: "Reviewed" }) },
		};
		const repository = new PrismaPersonaInterviewRepository(_prisma(transaction));

		await expect(repository.startAtomically(_startCommand())).resolves.toEqual({ status: "started", interviewId: "interview-created" });
		expect(transaction.personaQuestionSet.findUnique).toHaveBeenCalledWith({ where: { id_version: { id: "onboarding", version: 1 } }, select: { state: true } });
		expect(transaction.personaInterview.create).toHaveBeenCalledWith({ data: expect.objectContaining({ personaProfileId: "profile-1", userId: "user-1", questionSetId: "onboarding", questionSetVersion: 1 }), select: { id: true } });
	});

	it("replays the same proposal-bound refresh interview after a lost start response", async function _ReplaysRefreshStart()
	{
		const transaction = {
			$queryRaw: vi.fn().mockResolvedValue([{ id: "profile-1" }]),
			personalConfigurationChange: { findFirst: vi.fn().mockResolvedValue({ id: "change-1" }) },
			personaInterview: { findFirst: vi.fn().mockResolvedValue({ id: "interview-existing", refreshConfigurationChangeId: "change-1" }), create: vi.fn() },
			personaQuestionSet: { findUnique: vi.fn() },
		};
		const repository = new PrismaPersonaInterviewRepository(_prisma(transaction));

		await expect(repository.startAtomically({ ..._startCommand(), refreshConfigurationChangeId: "change-1" })).resolves.toEqual({ status: "already_in_progress", interviewId: "interview-existing" });
		expect(transaction.personaInterview.create).not.toHaveBeenCalled();
		expect(transaction.personaQuestionSet.findUnique).not.toHaveBeenCalled();
	});

	it("accepts PostgreSQL's in_progress label while appending an answer", async function _acceptsDatabaseLifecycleLabel()
	{
		const transaction = {
			$queryRaw: vi.fn().mockResolvedValue([{ questionSetId: "onboarding", questionSetVersion: 1, state: "in_progress" }]),
			personaQuestion: { findUnique: vi.fn().mockResolvedValue({ id: "q1" }) },
			personaInterviewAnswer: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: "answer-created" }) },
		};
		const repository = new PrismaPersonaInterviewRepository(_prisma(transaction));

		await expect(repository.recordAnswerAtomically({ userId: "user-1", personaProfileId: "profile-1", interviewId: "interview-1", questionId: "q1", value: "A considered answer", answeredAt: "2026-07-23T09:01:00.000Z" })).resolves.toEqual({ status: "recorded", answerId: "answer-created" });
		expect(transaction.personaInterviewAnswer.create).toHaveBeenCalledWith({ data: expect.objectContaining({ interviewId: "interview-1", questionSetId: "onboarding", questionSetVersion: 1, questionId: "q1" }), select: { id: true } });
	});
});
