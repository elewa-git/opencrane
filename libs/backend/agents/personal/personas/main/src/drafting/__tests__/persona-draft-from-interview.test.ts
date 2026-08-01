import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import type { Logger } from "@opencrane/observability";

import type { PersonaPersistenceUnitOfWork } from "../../profile/persona-persistence-unit-of-work.types.js";
import { PrismaPersonaAggregateLockRepository } from "../../profile/prisma-persona-aggregate-lock-repository.js";
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

	it("logs one unexpected interview read failure and returns a fail-closed denial", async function _LogsReadFailure()
	{
		const err = new Error("database unavailable");
		const logger = _Logger();
		const transactions = { run: vi.fn().mockRejectedValue(err) } as unknown as PersonaPersistenceUnitOfWork;
		const repository = new PrismaPersonaDraftRepository(transactions, new PrismaPersonaAggregateLockRepository(), new PrismaPersonaDraftTemplateSelector(), logger);

		await expect(__CreatePersonaDraftFromInterview(repository, _Command())).resolves.toEqual({ outcome: "denied", reason: "persistence_unavailable" });
		expect(logger.error).toHaveBeenCalledOnce();
		expect(logger.error).toHaveBeenCalledWith({ err, operation: "persona.draft.derive", siloId: "silo-1", userId: "user-1", personaProfileId: "profile-1", interviewId: "interview-1" }, "Persona draft derivation persistence failed");
	});

	it("logs one P2024 draft transaction failure and returns a fail-closed denial", async function _LogsCreateFailure()
	{
		const err = new Prisma.PrismaClientKnownRequestError("connection pool timeout", { code: "P2024", clientVersion: "test" });
		const logger = _Logger();
		const transactions = { run: vi.fn().mockRejectedValue(err) } as unknown as PersonaPersistenceUnitOfWork;
		const repository = new PrismaPersonaDraftRepository(transactions, new PrismaPersonaAggregateLockRepository(), new PrismaPersonaDraftTemplateSelector(), logger);

		await expect(__CreatePersonaDraftFromInterview(repository, _Command())).resolves.toEqual({ outcome: "denied", reason: "persistence_unavailable" });
		expect(logger.error).toHaveBeenCalledOnce();
		expect(logger.error).toHaveBeenCalledWith({ err, operation: "persona.draft.derive", siloId: "silo-1", userId: "user-1", personaProfileId: "profile-1", interviewId: "interview-1" }, "Persona draft derivation persistence failed");
	});

	it("classifies a concurrent unique-key race as a conflict without logging an operational failure", async function _ClassifiesConflict()
	{
		const conflict = new Prisma.PrismaClientKnownRequestError("revision race", { code: "P2002", clientVersion: "test" });
		const logger = _Logger();
		const transactions = { run: vi.fn().mockRejectedValue(conflict) } as unknown as PersonaPersistenceUnitOfWork;
		const repository = new PrismaPersonaDraftRepository(transactions, new PrismaPersonaAggregateLockRepository(), new PrismaPersonaDraftTemplateSelector(), logger);

		await expect(__CreatePersonaDraftFromInterview(repository, _Command())).resolves.toEqual({ outcome: "denied", reason: "conflict" });
		expect(logger.error).not.toHaveBeenCalled();
	});
});
