import { describe, expect, it, vi } from "vitest";
import { PersonaInterviewCategory, Prisma } from "@prisma/client";
import type { Logger } from "@opencrane/observability";

import type { PersonaPersistenceUnitOfWork } from "../../profile/persona-persistence-unit-of-work.types.js";
import { PrismaPersonaAggregateReadRepository } from "../../profile/prisma-persona-aggregate-read-repository.js";
import { __CreatePersonaDraftFromInterview } from "../persona-draft-from-interview.js";
import type { PersonaDraftFromInterviewRepository } from "../persona-draft-authority.types.js";
import { PrismaPersonaDraftRepository } from "../prisma-persona-draft-repository.js";
import { PrismaPersonaDraftTemplateSelector } from "../prisma-persona-draft-template-selector.js";

/** Build a complete server-owned draft request for one completed onboarding interview. */
function _Command()
{
	return { siloId: "silo-1", userId: "user-1", personaProfileId: "profile-1", interviewId: "interview-1", authoredAt: "2026-07-26T12:00:00.000Z" };
}

/** Creates an injected structured logger with an observable error method. */
function _Logger(): Logger
{
	return { error: vi.fn() } as unknown as Logger;
}

describe("__CreatePersonaDraftFromInterview", function _DescribePersonaDraftFromInterview()
{
	it("rejects malformed owner coordinates before persistence", async function _RejectsMalformedCommand()
	{
		const repository = { createFromInterviewAtomically: vi.fn() } as unknown as PersonaDraftFromInterviewRepository;

		await expect(__CreatePersonaDraftFromInterview(repository, { ..._Command(), userId: " " })).resolves.toEqual({ outcome: "denied", reason: "invalid_command" });
		expect(repository.createFromInterviewAtomically).not.toHaveBeenCalled();
	});

	it("delegates insight derivation without accepting browser-supplied insight text", async function _DelegatesServerDerivedInsights()
	{
		const createFromInterviewAtomically = vi.fn().mockResolvedValue({ status: "created", personaRevisionId: "revision-1" });
		const repository = { createFromInterviewAtomically } as PersonaDraftFromInterviewRepository;

		await expect(__CreatePersonaDraftFromInterview(repository, _Command())).resolves.toEqual({ outcome: "created", personaRevisionId: "revision-1" });
		expect(createFromInterviewAtomically).toHaveBeenCalledWith(_Command());
	});

	it("derives bounded insights and persists their exact question provenance in one transaction", async function _PersistsDerivedInsights()
	{
		const logger = _Logger();
		const createRevision = vi.fn().mockResolvedValue({ id: "revision-2" });
		const createInsights = vi.fn().mockResolvedValue({ count: 3 });
		const transaction = {
			personaProfile: { findFirst: vi.fn().mockResolvedValue({ siloId: "silo-1", activeRevisionId: "revision-1" }) },
			personaInterview: { findFirst: vi.fn().mockResolvedValue({ questionSetId: "onboarding", questionSetVersion: 1, state: "completed" }) },
			personaInterviewAnswer: { findMany: vi.fn().mockResolvedValue([{ id: "answer-1", questionSetId: "onboarding", questionSetVersion: 1, questionId: "question-1", value: " one " }, { id: "answer-2", questionSetId: "onboarding", questionSetVersion: 1, questionId: "question-2", value: "two" }, { id: "answer-3", questionSetId: "onboarding", questionSetVersion: 1, questionId: "question-3", value: "three" }]) },
			personaSoulTemplate: { findMany: vi.fn().mockResolvedValue([{ id: "direct", version: 1, digest: "sha256:template", content: "Be direct.", selectionRules: [{ id: "rule-1", priority: 20, answers: { "question-1": " one " } }] }]) },
			personaQuestion: { findMany: vi.fn().mockResolvedValue([{ id: "question-1", category: PersonaInterviewCategory.RelationshipRole }, { id: "question-2", category: PersonaInterviewCategory.ToneLanguage }, { id: "question-3", category: PersonaInterviewCategory.WorkingHabits }]) },
			personaRevision: { findFirst: vi.fn().mockResolvedValue({ revision: 1 }), create: createRevision },
			personaInsight: { createMany: createInsights },
		};
		const transactions = { run: vi.fn(async function _run(work) { return work(transaction); }) } as unknown as PersonaPersistenceUnitOfWork;
		const repository = new PrismaPersonaDraftRepository(transactions, new PrismaPersonaAggregateReadRepository(), new PrismaPersonaDraftTemplateSelector(), logger);

		await expect(__CreatePersonaDraftFromInterview(repository, _Command())).resolves.toEqual({ outcome: "created", personaRevisionId: "revision-2" });
		expect(createRevision).toHaveBeenCalledWith({ data: expect.objectContaining({ personaProfileId: "profile-1", revision: 2, soulTemplateId: "direct", soulTemplateVersion: 1, soulTemplateDigest: "sha256:template", selectionRuleId: "rule-1", selectionAnswerIds: ["answer-1"], compiledInstructions: "Be direct.\n\n## Interview insights\n- Owner response: one\n- Owner response: two\n- Owner response: three\n", previousRevisionId: "revision-1" }), select: { id: true } });
		expect(createInsights).toHaveBeenCalledWith({ data: [
			expect.objectContaining({ personaRevisionId: "revision-2", answerId: "answer-1", questionId: "question-1", category: PersonaInterviewCategory.RelationshipRole, statement: "Owner response: one" }),
			expect.objectContaining({ personaRevisionId: "revision-2", answerId: "answer-2", questionId: "question-2", category: PersonaInterviewCategory.ToneLanguage, statement: "Owner response: two" }),
			expect.objectContaining({ personaRevisionId: "revision-2", answerId: "answer-3", questionId: "question-3", category: PersonaInterviewCategory.WorkingHabits, statement: "Owner response: three" }),
		] });
		expect(logger.error).not.toHaveBeenCalled();
	});

	it("logs one unexpected transaction failure and returns a fail-closed denial", async function _LogsCreateFailure()
	{
		const err = new Prisma.PrismaClientKnownRequestError("connection pool timeout", { code: "P2024", clientVersion: "test" });
		const logger = _Logger();
		const transactions = { run: vi.fn().mockRejectedValue(err) } as unknown as PersonaPersistenceUnitOfWork;
		const repository = new PrismaPersonaDraftRepository(transactions, new PrismaPersonaAggregateReadRepository(), new PrismaPersonaDraftTemplateSelector(), logger);

		await expect(__CreatePersonaDraftFromInterview(repository, _Command())).resolves.toEqual({ outcome: "denied", reason: "persistence_unavailable" });
		expect(logger.error).toHaveBeenCalledOnce();
		expect(logger.error).toHaveBeenCalledWith({ err, operation: "persona.draft.create", siloId: "silo-1", userId: "user-1", personaProfileId: "profile-1", interviewId: "interview-1" }, "Persona draft persistence failed");
	});

	it("classifies a concurrent unique-key race as a conflict without logging an operational failure", async function _ClassifiesConflict()
	{
		const conflict = new Prisma.PrismaClientKnownRequestError("revision race", { code: "P2002", clientVersion: "test" });
		const logger = _Logger();
		const transactions = { run: vi.fn().mockRejectedValue(conflict) } as unknown as PersonaPersistenceUnitOfWork;
		const repository = new PrismaPersonaDraftRepository(transactions, new PrismaPersonaAggregateReadRepository(), new PrismaPersonaDraftTemplateSelector(), logger);

		await expect(__CreatePersonaDraftFromInterview(repository, _Command())).resolves.toEqual({ outcome: "denied", reason: "conflict" });
		expect(logger.error).not.toHaveBeenCalled();
	});
});
