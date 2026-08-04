import { describe, expect, it, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { PersonalConfigurationPersonaRefreshClaimCodes, type PersonalConfigurationPersonaRefreshUnitOfWork } from "@opencrane/backend/agents/personal/configuration";

import { PersonaInterviewDenialReasons, PersonaLifecycleOutcomes } from "../../profile/persona-lifecycle.types.js";
import type { Logger } from "@opencrane/observability";

import type { PersonaPersistenceUnitOfWork } from "../../profile/persona-persistence-unit-of-work.types.js";
import { PrismaPersonaAggregateReadRepository } from "../../profile/prisma-persona-aggregate-read-repository.js";
import { __CompletePersonaInterview, __RecordPersonaInterviewAnswer, __StartPersonaInterview } from "../persona-interview-authority.js";
import type { PersonaInterviewRepository } from "../persona-interview-authority.types.js";
import { PrismaPersonaInterviewRepository } from "../prisma-persona-interview-repository.js";

/** Creates a repository that records lifecycle calls without using a database. */
function _repository(overrides: Partial<PersonaInterviewRepository> = {}): PersonaInterviewRepository
{
	return {
		startAtomically: async function _start() { return { status: PersonaLifecycleOutcomes.Started, interviewId: "interview-1" } as const; },
		recordAnswerAtomically: async function _record() { return { status: PersonaLifecycleOutcomes.Recorded, answerId: "answer-1" } as const; },
		completeAtomically: async function _complete() { return { status: PersonaLifecycleOutcomes.Completed } as const; },
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

/** Runs the persona callback against one fake transaction and configuration-owned refresh port. */
function _refreshes(transaction: unknown): PersonalConfigurationPersonaRefreshUnitOfWork
{
	return {
		runPersonaRefresh: async function _run(work)
		{
			return work(transaction as never, {
				claimAcceptedPersonaRefresh: async function _claim() { return PersonalConfigurationPersonaRefreshClaimCodes.Accepted; },
				applyApprovedPersonaRefresh: async function _apply() { return true; },
			});
		},
	};
}

/** Runs an interview-only operation against the one fake transaction. */
function _transactions(transaction: unknown): PersonaPersistenceUnitOfWork
{
	return { run: async function _run(work) { return work(transaction as never); } };
}

/** Creates an injected structured logger with an observable error method. */
function _logger(): Logger
{
	return { error: vi.fn() } as unknown as Logger;
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
			personaProfile: { findFirst: vi.fn().mockResolvedValue({ siloId: "silo-1", activeRevisionId: null }) },
			personaInterview: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: "interview-created" }) },
			personaQuestionSet: { findUnique: vi.fn().mockResolvedValue({ state: "Reviewed" }) },
		};
		const repository = new PrismaPersonaInterviewRepository(_prisma(transaction), _refreshes(transaction), _transactions(transaction), new PrismaPersonaAggregateReadRepository(), _logger());

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
		};
		const repository = new PrismaPersonaInterviewRepository(_prisma(transaction), _refreshes(transaction), _transactions(transaction), new PrismaPersonaAggregateReadRepository(), _logger());

		await expect(repository.startAtomically({ ..._startCommand(), refreshConfigurationChangeId: "change-1" })).resolves.toEqual({ status: "already_in_progress", interviewId: "interview-existing" });
		expect(transaction.personaInterview.create).not.toHaveBeenCalled();
		expect(transaction.personaQuestionSet.findUnique).not.toHaveBeenCalled();
	});

	it("appends an answer only while the owner interview is still in progress", async function _appendsWhileInProgress()
	{
		const transaction = {
			personaInterview: { findFirst: vi.fn().mockResolvedValue({ questionSetId: "onboarding", questionSetVersion: 1, state: "InProgress" }) },
			personaQuestion: { findUnique: vi.fn().mockResolvedValue({ id: "q1" }) },
			personaInterviewAnswer: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: "answer-created" }) },
		};
		const repository = new PrismaPersonaInterviewRepository(_prisma(transaction), _refreshes(transaction), _transactions(transaction), new PrismaPersonaAggregateReadRepository(), _logger());

		await expect(repository.recordAnswerAtomically({ userId: "user-1", personaProfileId: "profile-1", interviewId: "interview-1", questionId: "q1", value: "A considered answer", answeredAt: "2026-07-23T09:01:00.000Z" })).resolves.toEqual({ status: "recorded", answerId: "answer-created" });
		expect(transaction.personaInterviewAnswer.create).toHaveBeenCalledWith({ data: expect.objectContaining({ interviewId: "interview-1", questionSetId: "onboarding", questionSetVersion: 1, questionId: "q1" }), select: { id: true } });
	});

	it("classifies a serializable write race as a conflict without logging an operational failure", async function _classifiesSerializableConflict()
	{
		const conflict = new Prisma.PrismaClientKnownRequestError("could not serialize access", { code: "P2034", clientVersion: "test" });
		const logger = _logger();
		const transactions = { run: vi.fn().mockRejectedValue(conflict) } as unknown as PersonaPersistenceUnitOfWork;
		const repository = new PrismaPersonaInterviewRepository(_prisma({}), _refreshes({}), transactions, new PrismaPersonaAggregateReadRepository(), logger);

		await expect(repository.completeAtomically({ userId: "user-1", personaProfileId: "profile-1", interviewId: "interview-1", completedAt: "2026-07-23T09:02:00.000Z" })).resolves.toEqual({ status: PersonaInterviewDenialReasons.Conflict });
		expect(logger.error).not.toHaveBeenCalled();
	});

	it("logs one unexpected start failure and returns a fail-closed denial", async function _logsStartFailure()
	{
		const err = new Error("database unavailable");
		const logger = _logger();
		const refreshes = { runPersonaRefresh: vi.fn().mockRejectedValue(err) } as unknown as PersonalConfigurationPersonaRefreshUnitOfWork;
		const repository = new PrismaPersonaInterviewRepository(_prisma({}), refreshes, _transactions({}), new PrismaPersonaAggregateReadRepository(), logger);

		await expect(__StartPersonaInterview(repository, _startCommand())).resolves.toEqual({ outcome: "denied", reason: "persistence_unavailable" });
		expect(logger.error).toHaveBeenCalledOnce();
		expect(logger.error).toHaveBeenCalledWith({ err, operation: "persona.interview.start", siloId: "silo-1", userId: "user-1", personaProfileId: "profile-1" }, "Persona interview start persistence failed");
	});

	it("logs one unexpected answer failure and returns a fail-closed denial", async function _logsAnswerFailure()
	{
		const err = new Error("database unavailable");
		const logger = _logger();
		const transactions = { run: vi.fn().mockRejectedValue(err) } as unknown as PersonaPersistenceUnitOfWork;
		const repository = new PrismaPersonaInterviewRepository(_prisma({}), _refreshes({}), transactions, new PrismaPersonaAggregateReadRepository(), logger);

		await expect(__RecordPersonaInterviewAnswer(repository, { userId: "user-1", personaProfileId: "profile-1", interviewId: "interview-1", questionId: "q1", value: "answer", answeredAt: "2026-07-23T09:01:00.000Z" })).resolves.toEqual({ outcome: "denied", reason: "persistence_unavailable" });
		expect(logger.error).toHaveBeenCalledOnce();
		expect(logger.error).toHaveBeenCalledWith({ err, operation: "persona.interview.answer", userId: "user-1", personaProfileId: "profile-1", interviewId: "interview-1" }, "Persona interview answer persistence failed");
	});

	it("logs one unexpected completion failure and returns a fail-closed denial", async function _logsCompletionFailure()
	{
		const err = new Error("database unavailable");
		const logger = _logger();
		const transactions = { run: vi.fn().mockRejectedValue(err) } as unknown as PersonaPersistenceUnitOfWork;
		const repository = new PrismaPersonaInterviewRepository(_prisma({}), _refreshes({}), transactions, new PrismaPersonaAggregateReadRepository(), logger);

		await expect(__CompletePersonaInterview(repository, { userId: "user-1", personaProfileId: "profile-1", interviewId: "interview-1", completedAt: "2026-07-23T09:02:00.000Z" })).resolves.toEqual({ outcome: "denied", reason: "persistence_unavailable" });
		expect(logger.error).toHaveBeenCalledOnce();
		expect(logger.error).toHaveBeenCalledWith({ err, operation: "persona.interview.complete", userId: "user-1", personaProfileId: "profile-1", interviewId: "interview-1" }, "Persona interview completion persistence failed");
	});
});
