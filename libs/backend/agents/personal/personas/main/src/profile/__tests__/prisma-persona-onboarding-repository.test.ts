import { PersonaQuestionSetState, type Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PersonaOnboardingDenialReasons } from "../persona-onboarding-authority.types.js";
import { PrismaPersonaOnboardingRepository } from "../prisma-persona-onboarding-repository.js";

/** Build the narrow transaction-scoped Prisma surface used by onboarding provisioning. */
function _prisma(questionSetState: PersonaQuestionSetState | null = PersonaQuestionSetState.Reviewed): Prisma.TransactionClient
{
	return {
		personaQuestionSet: { findUnique: vi.fn().mockResolvedValue(questionSetState === null ? null : { state: questionSetState }) },
		personaScoringPolicy: { findUnique: vi.fn().mockResolvedValue({ digest: "sha256:policy" }) },
		personaInterpolationMap: { findUnique: vi.fn().mockResolvedValue({ digest: "sha256:map" }) },
		personaProfile: { upsert: vi.fn().mockResolvedValue({ id: "profile-1" }) },
	} as unknown as Prisma.TransactionClient;
}

describe("PrismaPersonaOnboardingRepository", function _describePrismaPersonaOnboardingRepository()
{
	it("verifies the reviewed catalogue before provisioning the owner profile", async function _provisionsOwnerProfile()
	{
		const prisma = _prisma();
		const repository = new PrismaPersonaOnboardingRepository(prisma);

		await expect(repository.ensureAtomically({ siloId: "silo-1", userId: "user-1", provisionedAt: "2026-07-26T12:00:00.000Z" })).resolves.toEqual({ outcome: "ready", personaProfileId: "profile-1", questionSet: { id: "personal-agent-onboarding", version: 1 }, derivation: { scoringPolicyId: "personal-agent-scoring", scoringPolicyVersion: 1, interpolationMapId: "personal-agent-interpolation", interpolationMapVersion: 1 } });
		expect(prisma.personaQuestionSet.findUnique).toHaveBeenCalledBefore(prisma.personaProfile.upsert as never);
		expect(prisma.personaProfile.upsert).toHaveBeenCalledWith({ where: { siloId_userId: { siloId: "silo-1", userId: "user-1" } }, create: { siloId: "silo-1", userId: "user-1", createdAt: new Date("2026-07-26T12:00:00.000Z"), updatedAt: new Date("2026-07-26T12:00:00.000Z") }, update: {}, select: { id: true } });
	});

	it.each([null, PersonaQuestionSetState.Draft] as const)("refuses provisioning when the baseline catalogue state is %s", async function _rejectsUnavailableCatalogue(questionSetState)
	{
		const prisma = _prisma(questionSetState);
		const repository = new PrismaPersonaOnboardingRepository(prisma);

		await expect(repository.ensureAtomically({ siloId: "silo-1", userId: "user-1", provisionedAt: "2026-07-26T12:00:00.000Z" })).resolves.toEqual({ outcome: "denied", reason: PersonaOnboardingDenialReasons.CatalogueUnavailable });
		expect(prisma.personaProfile.upsert).not.toHaveBeenCalled();
	});
});
