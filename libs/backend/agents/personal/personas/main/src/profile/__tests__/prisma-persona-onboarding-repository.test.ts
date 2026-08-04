import { PersonaQuestionSetState, type PrismaClient } from "@prisma/client";
import type { Logger } from "@opencrane/observability";
import { describe, expect, it, vi } from "vitest";

import { PersonaOnboardingDenialReasons } from "../persona-onboarding-authority.types.js";
import { PrismaPersonaOnboardingRepository } from "../prisma-persona-onboarding-repository.js";
import type { PersonaPersistenceUnitOfWork } from "../persona-persistence-unit-of-work.types.js";

/** Build the narrow transaction-scoped Prisma surface used by onboarding provisioning. */
function _prisma(questionSetState: PersonaQuestionSetState | null = PersonaQuestionSetState.Reviewed): PrismaClient
{
	return {
		personaQuestionSet: { findUnique: vi.fn().mockResolvedValue(questionSetState === null ? null : { state: questionSetState }) },
		personaProfile: { upsert: vi.fn().mockResolvedValue({ id: "profile-1" }) },
	} as unknown as PrismaClient;
}

/** Run work against one observable transaction-scoped Prisma double. */
function _transactions(prisma: PrismaClient): PersonaPersistenceUnitOfWork
{
	return {
		async run<Result>(work: (transaction: unknown) => Promise<Result>): Promise<Result>
		{
			return work(prisma);
		},
	};
}

/** Build the structured logger surface used by the persistence wrapper. */
function _logger(): Logger
{
	return { error: vi.fn() } as unknown as Logger;
}

describe("PrismaPersonaOnboardingRepository", function _describePrismaPersonaOnboardingRepository()
{
	it("verifies the reviewed catalogue before provisioning the owner profile", async function _provisionsOwnerProfile()
	{
		const prisma = _prisma();
		const repository = new PrismaPersonaOnboardingRepository(_logger(), _transactions(prisma));

		await expect(repository.ensureAtomically({ siloId: "silo-1", userId: "user-1", provisionedAt: "2026-07-26T12:00:00.000Z" })).resolves.toEqual({ outcome: "ready", personaProfileId: "profile-1", questionSet: { id: "personal-agent-onboarding", version: 1 } });
		expect(prisma.personaQuestionSet.findUnique).toHaveBeenCalledBefore(prisma.personaProfile.upsert as never);
		expect(prisma.personaProfile.upsert).toHaveBeenCalledWith({ where: { siloId_userId: { siloId: "silo-1", userId: "user-1" } }, create: { siloId: "silo-1", userId: "user-1", createdAt: new Date("2026-07-26T12:00:00.000Z"), updatedAt: new Date("2026-07-26T12:00:00.000Z") }, update: {}, select: { id: true } });
	});

	it.each([null, PersonaQuestionSetState.Draft] as const)("refuses provisioning when the baseline catalogue state is %s", async function _rejectsUnavailableCatalogue(questionSetState)
	{
		const prisma = _prisma(questionSetState);
		const logger = _logger();
		const repository = new PrismaPersonaOnboardingRepository(logger, _transactions(prisma));

		await expect(repository.ensureAtomically({ siloId: "silo-1", userId: "user-1", provisionedAt: "2026-07-26T12:00:00.000Z" })).resolves.toEqual({ outcome: "denied", reason: PersonaOnboardingDenialReasons.CatalogueUnavailable });
		expect(prisma.personaProfile.upsert).not.toHaveBeenCalled();
		expect(logger.error).not.toHaveBeenCalled();
	});

	it("logs and translates an unexpected persistence failure exactly once", async function _translatesPersistenceFailure()
	{
		const prisma = _prisma();
		const error = new Error("database unavailable");
		const logger = _logger();
		const transactions = { run: vi.fn().mockRejectedValue(error) } as unknown as PersonaPersistenceUnitOfWork;
		const repository = new PrismaPersonaOnboardingRepository(logger, transactions);

		await expect(repository.ensureAtomically({ siloId: "silo-1", userId: "user-1", provisionedAt: "2026-07-26T12:00:00.000Z" })).resolves.toEqual({ outcome: "denied", reason: PersonaOnboardingDenialReasons.PersistenceUnavailable });
		expect(logger.error).toHaveBeenCalledOnce();
		expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ err: error, operation: "persona.onboarding.provision", siloId: "silo-1" }), "Persona onboarding provisioning is unavailable");
		expect(prisma.personaProfile.upsert).not.toHaveBeenCalled();
	});
});
