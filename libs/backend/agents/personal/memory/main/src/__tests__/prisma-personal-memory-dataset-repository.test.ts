import { AuthorizationScopeKind, GrantSubjectType, MemoryDatasetState } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaPersonalMemoryDatasetRepository } from "../prisma-personal-memory-dataset-repository.js";

/** Builds the smallest Prisma fake that exposes personal-dataset resolution. */
function _Prisma(dataset: { readonly id: string; readonly cogneeDatasetId: string } | null)
{
	return { memoryDataset: { findFirst: vi.fn().mockResolvedValue(dataset) } };
}

describe("Prisma personal memory dataset repository", function _describePrismaPersonalMemoryDataset()
{
	it("queries only the active personal dataset matching the full signed identity tuple", async function _queriesExactIdentity()
	{
		const prisma = _Prisma({ id: "dataset-1", cogneeDatasetId: "cognee-personal-1" });
		const repository = new PrismaPersonalMemoryDatasetRepository(prisma as never);

		await expect(repository.findActivePersonalDataset({ siloId: "silo-1", organizationId: "org-1", subjectId: "user-1" })).resolves.toEqual({ datasetId: "dataset-1", cogneeDatasetId: "cognee-personal-1" });
		expect(prisma.memoryDataset.findFirst).toHaveBeenCalledWith({ where: { siloId: "silo-1", organizationId: "org-1", scopeKind: AuthorizationScopeKind.Personal, subjectType: GrantSubjectType.User, scopeResourceId: "user-1", state: MemoryDatasetState.Active }, select: { id: true, cogneeDatasetId: true } });
	});

	it("returns no dataset when the exact active personal scope is absent", async function _returnsMissingScope()
	{
		await expect(new PrismaPersonalMemoryDatasetRepository(_Prisma(null) as never).findActivePersonalDataset({ siloId: "silo-1", organizationId: "org-1", subjectId: "user-1" })).resolves.toBeNull();
	});
});
