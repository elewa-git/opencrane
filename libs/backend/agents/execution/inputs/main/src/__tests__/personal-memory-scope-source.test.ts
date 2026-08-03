import { describe, expect, it, vi } from "vitest";

import { PersonalMemoryScopeSource } from "../personal-memory-scope-source.js";

describe("PersonalMemoryScopeSource", function _describePersonalMemoryScopeSource()
{
	it("selects the dataset from the verified organization and subject instead of caller input", async function _selectsVerifiedDataset()
	{
		const datasets = { findActivePersonalDataset: vi.fn().mockResolvedValue({ datasetId: "dataset-1", cogneeDatasetId: "cognee-personal-1" }) };
		const source = new PersonalMemoryScopeSource(datasets);

		await expect(source.load({ siloId: "silo-1" } as never, { agentKind: "personal" } as never, { kind: "user", organizationId: "org-1", executionSubjectId: "user-1" } as never, {} as never)).resolves.toEqual({ outcome: "loaded", value: { memoryQueryPolicy: { scope: "personal", datasets: [{ datasetId: "dataset-1", cogneeDatasetId: "cognee-personal-1" }] }, memoryFacts: [] } });
		expect(datasets.findActivePersonalDataset).toHaveBeenCalledWith({ siloId: "silo-1", organizationId: "org-1", subjectId: "user-1" });
	});

	it("refuses a managed run before personal dataset lookup", async function _deniesManagedRun()
	{
		const datasets = { findActivePersonalDataset: vi.fn() };
		const source = new PersonalMemoryScopeSource(datasets);

		await expect(source.load({ siloId: "silo-1" } as never, { agentKind: "managed" } as never, { kind: "user", organizationId: "org-1", executionSubjectId: "user-1" } as never, {} as never)).resolves.toEqual({ outcome: "denied", reason: "memory_scope_unavailable" });
		expect(datasets.findActivePersonalDataset).not.toHaveBeenCalled();
	});
});
