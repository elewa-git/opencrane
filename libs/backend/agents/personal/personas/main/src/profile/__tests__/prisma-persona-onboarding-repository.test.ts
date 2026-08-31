import { PersonaQuestionSetState, type Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PersonaOnboardingDenialReasons } from "../persona-onboarding-authority.types";
import { PrismaPersonaOnboardingRepository } from "../prisma-persona-onboarding-repository";
import type { PersonaProductAuthorizationRepository } from "../persona-product-authorization.types";

/** Build the narrow transaction-scoped Prisma surface used by onboarding provisioning. */
function _prisma(questionSetState: PersonaQuestionSetState | null = PersonaQuestionSetState.Reviewed): Prisma.TransactionClient
{
	return {
		personaQuestionSet: { findUnique: vi.fn().mockResolvedValue(questionSetState === null ? null : { state: questionSetState }) },
		personaScoringPolicy: { findUnique: vi.fn().mockResolvedValue({ digest: "sha256:policy" }) },
		personaInterpolationMap: { findUnique: vi.fn().mockResolvedValue({ digest: "sha256:map" }) },
		personaProfile: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: "profile-1" }) },
	} as unknown as Prisma.TransactionClient;
}

/** Allows every central decision while exposing creator-grant reconciliation to assertions. */
function _Authorization(overrides: Partial<PersonaProductAuthorizationRepository> = {}): PersonaProductAuthorizationRepository
{
	return { canRead: vi.fn().mockResolvedValue(true), admitEdit: vi.fn().mockResolvedValue(true), admitCollectionCreate: vi.fn().mockResolvedValue(true), reconcileCreator: vi.fn().mockResolvedValue(undefined), ...overrides };
}

describe("PrismaPersonaOnboardingRepository", function _describePrismaPersonaOnboardingRepository()
{
	it("verifies the reviewed catalogue before provisioning the owner profile", async function _provisionsOwnerProfile()
	{
		const prisma = _prisma();
		const authorization = _Authorization();
		const repository = new PrismaPersonaOnboardingRepository(prisma, authorization);

		await expect(repository.ensureAtomically({ siloId: "silo-1", principalId: "principal-1", userId: "user-1", provisionedAt: "2026-07-26T12:00:00.000Z" })).resolves.toEqual({ outcome: "ready", personaProfileId: "profile-1", questionSet: { id: "personal-agent-onboarding", version: 1 }, derivation: { scoringPolicyId: "personal-agent-scoring", scoringPolicyVersion: 1, interpolationMapId: "personal-agent-interpolation", interpolationMapVersion: 1 } });
		expect(prisma.personaQuestionSet.findUnique).toHaveBeenCalledBefore(prisma.personaProfile.create as never);
		expect(authorization.admitCollectionCreate).toHaveBeenCalledWith({ siloId: "silo-1", principalId: "principal-1" });
		expect(prisma.personaProfile.create).toHaveBeenCalledWith({ data: { id: expect.stringMatching(/^[0-9a-f-]{36}$/u), siloId: "silo-1", userId: "user-1", createdAt: new Date("2026-07-26T12:00:00.000Z"), updatedAt: new Date("2026-07-26T12:00:00.000Z") }, select: { id: true } });
		expect(authorization.reconcileCreator).toHaveBeenCalledWith({ siloId: "silo-1", principalId: "principal-1" }, "profile-1", new Date("2026-07-26T12:00:00.000Z"));
	});

	it("does not create a profile or grants when collection creation is denied", async function _DeniesCreation()
	{
		const prisma = _prisma();
		const authorization = _Authorization({ admitCollectionCreate: vi.fn().mockResolvedValue(false) });
		const repository = new PrismaPersonaOnboardingRepository(prisma, authorization);

		await expect(repository.ensureAtomically({ siloId: "silo-1", principalId: "principal-1", userId: "user-1", provisionedAt: "2026-07-26T12:00:00.000Z" })).resolves.toEqual({ outcome: "denied", reason: PersonaOnboardingDenialReasons.NotAuthorized });
		expect(prisma.personaProfile.create).not.toHaveBeenCalled();
		expect(authorization.reconcileCreator).not.toHaveBeenCalled();
	});

	it.each([null, PersonaQuestionSetState.Draft] as const)("refuses provisioning when the baseline catalogue state is %s", async function _rejectsUnavailableCatalogue(questionSetState)
	{
		const prisma = _prisma(questionSetState);
		const repository = new PrismaPersonaOnboardingRepository(prisma, _Authorization());

		await expect(repository.ensureAtomically({ siloId: "silo-1", principalId: "principal-1", userId: "user-1", provisionedAt: "2026-07-26T12:00:00.000Z" })).resolves.toEqual({ outcome: "denied", reason: PersonaOnboardingDenialReasons.CatalogueUnavailable });
		expect(prisma.personaProfile.create).not.toHaveBeenCalled();
	});
});
