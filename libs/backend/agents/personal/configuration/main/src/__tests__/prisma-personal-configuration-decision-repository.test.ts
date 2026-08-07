import { describe, expect, it, vi } from "vitest";

import { PersonalConfigurationDecisionCodes } from "../decision/personal-configuration-decision.types.js";
import { PrismaPersonalConfigurationDecisionRepository } from "../decision/prisma-personal-configuration-decision-repository.js";

describe("Prisma personal configuration decision repository", function _PrismaPersonalConfigurationDecisionRepositorySuite()
{
	it("compare-and-sets only a still-proposed change owned by the deciding user", async function _DecidesOwnedProposal()
	{
		const updateMany = vi.fn(async function _update() { return { count: 1 }; });
		const repository = new PrismaPersonalConfigurationDecisionRepository({ personalConfigurationChange: { updateMany, findFirst: vi.fn() } } as never);
		await expect(repository.decideAtomically({ siloId: "silo-1", userId: "user-1", changeId: "change-1", decision: PersonalConfigurationDecisionCodes.Accepted, rejectionReason: null, decidedAt: "2026-07-23T00:00:00.000Z" })).resolves.toEqual({ status: PersonalConfigurationDecisionCodes.Accepted });
		expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: "user-1", state: "Proposed" }), data: expect.objectContaining({ state: "Accepted", decidedBy: "user-1" }) }));
	});

	it("does not disclose a non-owned proposal after a lost compare-and-set", async function _HidesUnavailableDecision()
	{
		const repository = new PrismaPersonalConfigurationDecisionRepository({ personalConfigurationChange: { updateMany: vi.fn(async function _update() { return { count: 0 }; }), findFirst: vi.fn(async function _find() { return null; }) } } as never);
		await expect(repository.decideAtomically({ siloId: "silo-1", userId: "user-1", changeId: "change-1", decision: PersonalConfigurationDecisionCodes.Rejected, rejectionReason: "Keep current settings", decidedAt: "2026-07-23T00:00:00.000Z" })).resolves.toEqual({ status: PersonalConfigurationDecisionCodes.NotFoundOrNotOwner });
	});
});
