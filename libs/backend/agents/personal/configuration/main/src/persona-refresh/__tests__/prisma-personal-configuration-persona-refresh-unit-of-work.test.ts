import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PersonalConfigurationPersonaRefreshClaimCodes } from "../personal-configuration-persona-refresh.types.js";
import { PrismaPersonalConfigurationPersonaRefreshUnitOfWork } from "../prisma-personal-configuration-persona-refresh-unit-of-work.js";

/** Builds the narrow Prisma client needed to prove the configuration-owned refresh transaction boundary. */
function _Prisma(change: { readonly id: string } | null = { id: "change-1" }): PrismaClient
{
	const transaction = {
		personalConfigurationChange: {
			findFirst: vi.fn(async function _find() { return change; }),
			updateMany: vi.fn(async function _update() { return { count: 1 }; }),
		},
	};
	return {
		$transaction: vi.fn(async function _transaction(work: (client: unknown) => Promise<unknown>)
		{
			return work(transaction);
		}),
	} as unknown as PrismaClient;
}

describe("PrismaPersonalConfigurationPersonaRefreshUnitOfWork", function _describePersonaRefreshUnitOfWork()
{
	it("keeps proposal validation and application in the one transaction supplied to persona persistence", async function _keepsAtomicity()
	{
		const prisma = _Prisma();
		const unitOfWork = new PrismaPersonalConfigurationPersonaRefreshUnitOfWork(prisma);

		const result = await unitOfWork.runPersonaRefresh(async function _run(transaction, refreshes)
		{
			const command = { configurationChangeId: "change-1", siloId: "silo-1", userId: "user-1", personaProfileId: "profile-1" };
			expect(transaction).toBeDefined();
			expect(await refreshes.claimAcceptedPersonaRefresh(command)).toBe(PersonalConfigurationPersonaRefreshClaimCodes.Accepted);
			expect(await refreshes.applyApprovedPersonaRefresh({ ...command, personaRevisionId: "revision-1" })).toBe(true);
			return "atomic";
		});

		expect(result).toBe("atomic");
		expect(prisma.$transaction).toHaveBeenCalledOnce();
	});

	it("rejects an accepted configuration change whose patch is not a persona refresh", async function _rejectsNonRefreshProposal()
	{
		const unitOfWork = new PrismaPersonalConfigurationPersonaRefreshUnitOfWork(_Prisma(null));

		const outcome = await unitOfWork.runPersonaRefresh(async function _run(_transaction, refreshes)
		{
			return refreshes.claimAcceptedPersonaRefresh({ configurationChangeId: "model-change-1", siloId: "silo-1", userId: "user-1", personaProfileId: "profile-1" });
		});

		expect(outcome).toBe(PersonalConfigurationPersonaRefreshClaimCodes.Unavailable);
	});
});
