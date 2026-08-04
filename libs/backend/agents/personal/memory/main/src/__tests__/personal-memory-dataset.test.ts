import { describe, expect, it, vi } from "vitest";

import { __ResolvePersonalMemoryDataset } from "../personal-memory-dataset.js";
import { PersonalMemoryDatasetResolutionDenialReasons, PersonalMemoryDatasetResolutionOutcomes } from "../personal-memory-dataset.types.js";

/** Builds a repository fake exposing the exact proof-bound lookup seam. */
function _Repository(dataset: { readonly datasetId: string; readonly cogneeDatasetId: string } | null)
{
	return { findActivePersonalDataset: vi.fn().mockResolvedValue(dataset) };
}

describe("personal memory dataset authority", function _DescribePersonalMemoryDataset()
{
	it("resolves the active dataset only from signed silo, organization, and subject coordinates", async function _ResolvesExactScope()
	{
		const repository = _Repository({ datasetId: "dataset-1", cogneeDatasetId: "cognee-personal-1" });
		await expect(__ResolvePersonalMemoryDataset(repository as never, { siloId: "silo-1", organizationId: "org-1", subjectId: "user-1" })).resolves.toEqual({ outcome: PersonalMemoryDatasetResolutionOutcomes.Resolved, dataset: { datasetId: "dataset-1", cogneeDatasetId: "cognee-personal-1" } });
		expect(repository.findActivePersonalDataset).toHaveBeenCalledWith({ siloId: "silo-1", organizationId: "org-1", subjectId: "user-1" });
	});

	it("fails closed without a matching active personal dataset", async function _DeniesMissingScope()
	{
		await expect(__ResolvePersonalMemoryDataset(_Repository(null) as never, { siloId: "silo-1", organizationId: "org-1", subjectId: "user-1" })).resolves.toEqual({ outcome: PersonalMemoryDatasetResolutionOutcomes.Denied, reason: PersonalMemoryDatasetResolutionDenialReasons.MemoryScopeUnavailable });
	});

	it("rejects incomplete identity before any dataset lookup", async function _DeniesIncompleteIdentity()
	{
		const repository = _Repository({ datasetId: "dataset-1", cogneeDatasetId: "cognee-personal-1" });

		await expect(__ResolvePersonalMemoryDataset(repository as never, { siloId: "silo-1", organizationId: " ", subjectId: "user-1" })).resolves.toEqual({ outcome: PersonalMemoryDatasetResolutionOutcomes.Denied, reason: PersonalMemoryDatasetResolutionDenialReasons.MemoryScopeUnavailable });
		expect(repository.findActivePersonalDataset).not.toHaveBeenCalled();
	});
});
