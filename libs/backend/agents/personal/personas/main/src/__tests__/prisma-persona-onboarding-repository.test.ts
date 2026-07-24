import { PersonaQuestionSetState } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaPersonaOnboardingRepository } from "../prisma-persona-onboarding-repository.js";

/** Build the narrow Prisma fake required to test the onboarding composition adapter. */
function _Prisma(overrides: Record<string, unknown> = {})
{
	return {
		personaProfile: { upsert: vi.fn().mockResolvedValue({ id: "profile-1" }) },
		personaQuestionSet: { findUnique: vi.fn().mockResolvedValue({ id: "personal-agent-onboarding", version: 1, state: PersonaQuestionSetState.Reviewed, questions: [{ id: "relationship", category: "RelationshipRole", prompt: "How should I work with you?", ordinal: 1 }] }) },
		...overrides,
	};
}

describe("Prisma persona onboarding repository", function _DescribePrismaPersonaOnboardingRepository()
{
	it("creates or resolves a profile only from the silo and user selected by the server", async function _ResolvesProfile()
	{
		const prisma = _Prisma();
		const repository = new PrismaPersonaOnboardingRepository(prisma as never);
		await expect(repository.resolveForCaller({ siloId: "silo-1", userId: "oidc-subject" })).resolves.toEqual({ id: "profile-1" });
		expect(prisma.personaProfile.upsert).toHaveBeenCalledWith({ where: { siloId_userId: { siloId: "silo-1", userId: "oidc-subject" } }, create: { siloId: "silo-1", userId: "oidc-subject" }, update: {}, select: { id: true } });
	});

	it("exposes only the fixed reviewed clean-build source in ordinal order", async function _ReadsReviewedSource()
	{
		const prisma = _Prisma();
		const repository = new PrismaPersonaOnboardingRepository(prisma as never);
		await expect(repository.getReviewedQuestionSet()).resolves.toEqual({ id: "personal-agent-onboarding", version: 1, questions: [{ id: "relationship", category: "RelationshipRole", prompt: "How should I work with you?", ordinal: 1 }] });
		expect(prisma.personaQuestionSet.findUnique).toHaveBeenCalledWith({ where: { id_version: { id: "personal-agent-onboarding", version: 1 } }, select: { id: true, version: true, state: true, questions: { orderBy: { ordinal: "asc" }, select: { id: true, category: true, prompt: true, ordinal: true } } } });
	});

	it("withholds a draft or empty source until clean provisioning marks it reviewed", async function _WithholdsUnavailableSource()
	{
		const prisma = _Prisma({ personaQuestionSet: { findUnique: vi.fn().mockResolvedValue({ id: "personal-agent-onboarding", version: 1, state: PersonaQuestionSetState.Draft, questions: [] }) } });
		const repository = new PrismaPersonaOnboardingRepository(prisma as never);
		await expect(repository.getReviewedQuestionSet()).resolves.toBeNull();
	});
});
