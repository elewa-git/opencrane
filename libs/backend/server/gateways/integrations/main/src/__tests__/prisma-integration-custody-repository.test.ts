import { describe, expect, it, vi } from "vitest";

import { PrismaIntegrationCustodyRepository } from "../prisma-integration-custody-repository.js";

describe("Prisma integration custody repository", function _suite()
{
	it("rejects a foreign-silo integration before writing a ready custody reference", async function _foreignSilo()
	{
		const transaction = { $queryRaw: vi.fn(), integration: { findUnique: vi.fn().mockResolvedValue({ siloId: "other-silo", state: "Active", obotCatalogEntryId: "catalog-1" }) }, integrationCustodyReference: { create: vi.fn() } };
		const prisma = { $transaction: vi.fn(async function _transaction(callback: (client: typeof transaction) => Promise<unknown>) { return callback(transaction); }) } as never;
		await expect(new PrismaIntegrationCustodyRepository(prisma).persistReady({ siloId: "silo-1", integrationId: "integration-1", obotCatalogEntryId: "catalog-1", obotCustodyReference: "obot:issued:one", expiresAt: new Date("2026-07-20T00:00:00.000Z") })).rejects.toThrow("integration authority changed");
		expect(transaction.integrationCustodyReference.create).not.toHaveBeenCalled();
	});
});
