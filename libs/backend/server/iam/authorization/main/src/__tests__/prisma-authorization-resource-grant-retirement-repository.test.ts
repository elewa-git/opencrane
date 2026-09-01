import type { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";

import { PrismaAuthorizationResourceGrantRetirementRepository } from "../prisma-authorization-resource-grant-retirement-repository";

describe("PrismaAuthorizationResourceGrantRetirementRepository", function _Suite()
{
	it("soft-revokes every live grant on the exact silo-bound resource set", async function _RetireExactResources()
	{
		const updateMany = vi.fn(async function _Update() { return { count: 5 }; });
		const transaction = { authorizationGrant: { updateMany } } as unknown as Prisma.TransactionClient;
		const repository = new PrismaAuthorizationResourceGrantRetirementRepository(transaction);
		const now = new Date("2026-08-30T12:00:00.000Z");

		const count = await repository.retireResourceGrants({ siloId: "silo-1", resources: [{ kind: ProductAuthorizationResourceKinds.ProviderConnection, id: "provider-1" }, { kind: ProductAuthorizationResourceKinds.ModelDefinition, id: "model-1" }], now });

		expect(count).toBe(5);
		expect(updateMany).toHaveBeenCalledWith({
			where: {
				siloId: "silo-1",
				revokedAt: null,
				OR: [
					{ resourceKind: ProductAuthorizationResourceKinds.ProviderConnection, resourceId: "provider-1" },
					{ resourceKind: ProductAuthorizationResourceKinds.ModelDefinition, resourceId: "model-1" },
				],
			},
			data: { revokedAt: now },
		});
	});

	it("does not issue an unbounded update for an empty exact resource set", async function _RejectEmptySet()
	{
		const updateMany = vi.fn();
		const transaction = { authorizationGrant: { updateMany } } as unknown as Prisma.TransactionClient;
		const repository = new PrismaAuthorizationResourceGrantRetirementRepository(transaction);

		await expect(repository.retireResourceGrants({ siloId: "silo-1", resources: [], now: new Date(1) })).resolves.toBe(0);
		expect(updateMany).not.toHaveBeenCalled();
	});
});
