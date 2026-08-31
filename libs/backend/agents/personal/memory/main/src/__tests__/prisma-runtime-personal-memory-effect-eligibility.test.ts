import { AuthorizationBoundaryKind, MemoryDatasetState, type Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaRuntimePersonalMemoryEffectEligibilityAuthority } from "../prisma-runtime-personal-memory-effect-eligibility";

describe("PrismaRuntimePersonalMemoryEffectEligibilityAuthority", function _Suite()
{
	it("rejects a dataset outside the exact silo, Principal, personal boundary, or Active lifecycle", async function _RejectsMismatch()
	{
		const findFirst = vi.fn().mockResolvedValue(null);
		const transaction = { memoryDataset: { findFirst } } as unknown as Prisma.TransactionClient;
		const authority = new PrismaRuntimePersonalMemoryEffectEligibilityAuthority(transaction);

		await expect(authority.isEligible({ siloId: "silo-1", principalId: "principal-1", datasetId: "dataset-1" })).resolves.toBe(false);
		expect(findFirst).toHaveBeenCalledWith({
			where: {
				id: "dataset-1",
				siloId: "silo-1",
				state: MemoryDatasetState.Active,
				boundaryKind: AuthorizationBoundaryKind.Personal,
				boundaryPrincipalId: "principal-1",
				boundaryGroupId: null,
			},
			select: { id: true },
		});
	});
});
