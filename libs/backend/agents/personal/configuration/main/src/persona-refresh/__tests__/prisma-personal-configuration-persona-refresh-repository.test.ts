import type { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PersonalConfigurationPersonaRefreshClaimCodes } from "../personal-configuration-persona-refresh.types.js";
import { PrismaPersonalConfigurationPersonaRefreshRepository } from "../prisma-personal-configuration-persona-refresh-repository.js";

/** Builds the smallest transaction fake these repository tests need. */
function _Transaction(change: { readonly id: string } | null = { id: "change-1" }): Prisma.TransactionClient
{
	return {
		personalConfigurationChange: {
			findFirst: vi.fn(async function _find() { return change; }),
			updateMany: vi.fn(async function _update() { return { count: 1 }; }),
		},
	} as unknown as Prisma.TransactionClient;
}

describe("PrismaPersonalConfigurationPersonaRefreshRepository", function _describePersonaRefreshRepository()
{
	it("validates and applies the exact refresh proposal on its caller-owned transaction", async function _keepsAtomicity()
	{
		const transaction = _Transaction();
		const repository = new PrismaPersonalConfigurationPersonaRefreshRepository(transaction);
		const command = { configurationChangeId: "change-1", siloId: "silo-1", userId: "user-1", personaProfileId: "profile-1" };

		expect(await repository.claimAcceptedPersonaRefresh(command)).toBe(PersonalConfigurationPersonaRefreshClaimCodes.Accepted);
		expect(await repository.applyApprovedPersonaRefresh({ ...command, personaRevisionId: "revision-1" })).toBe(true);
		expect(transaction.personalConfigurationChange.findFirst).toHaveBeenCalledOnce();
		expect(transaction.personalConfigurationChange.updateMany).toHaveBeenCalledOnce();
	});

	it("rejects a proposal that configuration cannot prove is an accepted persona refresh", async function _rejectsUnavailableProposal()
	{
		const repository = new PrismaPersonalConfigurationPersonaRefreshRepository(_Transaction(null));
		const outcome = await repository.claimAcceptedPersonaRefresh({ configurationChangeId: "model-change-1", siloId: "silo-1", userId: "user-1", personaProfileId: "profile-1" });

		expect(outcome).toBe(PersonalConfigurationPersonaRefreshClaimCodes.Unavailable);
	});
});
