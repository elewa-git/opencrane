import { describe, expect, it, vi } from "vitest";

import { PrismaUpgradeSessionProfileRepository } from "../upgrade-session/prisma-upgrade-session-profile-repository";

describe("Prisma upgrade-session profile repository", function _PrismaUpgradeSessionProfileRepositorySuite()
{
	it("selects only the profile identifier for the exact frozen owner coordinates", async function _ReadsOwnerProfile()
	{
		const transaction = { personaProfile: { findUnique: vi.fn(async function _FindProfile() { return { id: "profile-1" }; }) } };
		const repository = new PrismaUpgradeSessionProfileRepository(transaction as never);

		await expect(repository.readOwnerProfileId({ siloId: "silo-1", userId: "user-1" })).resolves.toBe("profile-1");
		expect(transaction.personaProfile.findUnique).toHaveBeenCalledWith({
			where: { siloId_userId: { siloId: "silo-1", userId: "user-1" } },
			select: { id: true },
		});
	});

	it("returns null when the frozen owner has no personal profile", async function _ReadsMissingOwnerProfile()
	{
		const transaction = { personaProfile: { findUnique: vi.fn(async function _FindProfile() { return null; }) } };
		const repository = new PrismaUpgradeSessionProfileRepository(transaction as never);

		await expect(repository.readOwnerProfileId({ siloId: "silo-1", userId: "user-1" })).resolves.toBeNull();
	});
});
