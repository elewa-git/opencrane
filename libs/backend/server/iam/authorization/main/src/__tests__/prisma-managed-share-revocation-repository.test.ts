import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaManagedShareRevocationRepository } from "../prisma-managed-share-revocation-repository";

/** Builds a narrow Prisma stub owned by this adapter's tests. */
function _prisma(count: number)
{
	const prisma = { authorizationGrant: { updateMany: vi.fn(async function _updateMany() { return { count }; }) } };
	return { ...prisma, client: prisma as unknown as PrismaClient };
}

describe("PrismaManagedShareRevocationRepository", function _suite()
{
	it("soft-revokes only the exact live grant owned by the silo, manager, and creating Principal", async function _managedGrant()
	{
		const prisma = _prisma(1);
		const repository = new PrismaManagedShareRevocationRepository(prisma.client);

		const revoked = await repository.revokeManagedShare("silo-1", "resource-share-editor", "owner-1", "grant-1");

		expect(revoked).toBe(true);
		expect(vi.mocked(prisma.authorizationGrant.updateMany)).toHaveBeenCalledWith({
			where: { id: "grant-1", siloId: "silo-1", managerId: "resource-share-editor", createdBy: "owner-1", revokedAt: null },
			data: { revokedAt: expect.any(Date) },
		});
	});

	it("reports a mismatch when no exact managed grant can be revoked", async function _mismatch()
	{
		const prisma = _prisma(0);
		const repository = new PrismaManagedShareRevocationRepository(prisma.client);

		await expect(repository.revokeManagedShare("silo-1", "resource-share-editor", "owner-1", "grant-1")).resolves.toBe(false);
	});
});
