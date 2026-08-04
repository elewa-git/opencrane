import { AuthorizationScopeKind, MemoryConsentState, MemoryDatasetState, MemoryFactState } from "@prisma/client";
import { MemoryFactProvenanceSourceKinds } from "@opencrane/contracts";
import { describe, expect, it, vi } from "vitest";

import { PrismaPersonalMemoryAdmissionRepository } from "../prisma-personal-memory-admission-repository.js";

/** Builds the smallest transaction facade that exposes personal-memory admission reads. */
function _Transaction(dataset: { readonly id: string; readonly cogneeDatasetId: string } | null, facts: readonly unknown[] = [])
{
	return { memoryDataset: { findFirst: vi.fn().mockResolvedValue(dataset) }, memoryFactCatalog: { findMany: vi.fn().mockResolvedValue(facts) } };
}

describe("Prisma personal memory admission repository", function _DescribePrismaPersonalMemoryAdmissionRepository()
{
	it("queries only the active personal dataset matching the full signed identity tuple", async function _QueriesExactIdentity()
	{
		const transaction = _Transaction({ id: "dataset-1", cogneeDatasetId: "cognee-personal-1" });
		const repository = new PrismaPersonalMemoryAdmissionRepository(transaction as never);

		await expect(repository.findActivePersonalDataset({ siloId: "silo-1", organizationId: "org-1", subjectId: "user-1" })).resolves.toEqual({ datasetId: "dataset-1", cogneeDatasetId: "cognee-personal-1" });
		expect(transaction.memoryDataset.findFirst).toHaveBeenCalledWith({ where: { siloId: "silo-1", organizationId: "org-1", scopeKind: AuthorizationScopeKind.Personal, scopeResourceId: "user-1", state: MemoryDatasetState.Active }, select: { id: true, cogneeDatasetId: true } });
	});

	it("selects only active consented facts whose provenance names the exact verified owner", async function _SelectsOwnerPreferenceFacts()
	{
		const transaction = _Transaction({ id: "dataset-1", cogneeDatasetId: "cognee-personal-1" }, [{ id: "fact-1", provenance: { sourceKind: MemoryFactProvenanceSourceKinds.ExplicitUserFact, sourceUserId: "user-1" } }, { id: "fact-2", provenance: { sourceKind: MemoryFactProvenanceSourceKinds.Message, sourceUserId: "user-1" } }]);

		await expect(new PrismaPersonalMemoryAdmissionRepository(transaction as never).findActivePreferenceFactIds({ siloId: "silo-1", organizationId: "org-1", subjectId: "user-1" })).resolves.toEqual(["fact-1"]);
		expect(transaction.memoryFactCatalog.findMany).toHaveBeenCalledWith({ where: { datasetId: "dataset-1", state: MemoryFactState.Active, consentState: { in: [MemoryConsentState.Explicit, MemoryConsentState.Confirmed] } }, select: { id: true, provenance: true } });
	});

	it("returns no preference facts when the exact active personal scope is absent", async function _ReturnsMissingScope()
	{
		await expect(new PrismaPersonalMemoryAdmissionRepository(_Transaction(null) as never).findActivePreferenceFactIds({ siloId: "silo-1", organizationId: "org-1", subjectId: "user-1" })).resolves.toEqual([]);
	});
});
