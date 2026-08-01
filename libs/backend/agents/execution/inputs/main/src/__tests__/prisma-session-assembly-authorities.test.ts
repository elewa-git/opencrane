import { describe, expect, it, vi } from "vitest";
import { MemoryFactProvenanceSourceKinds } from "@opencrane/contracts";

import { ManagedNoPersonalMemoryScopeSource } from "../managed-no-personal-memory-scope-source.js";
import { PersonalMemoryScopeSource } from "../personal-memory-scope-source.js";
import { __CreatePrismaManagedSessionAssemblyAuthorities, __CreatePrismaPersonalSessionAssemblyAuthorities } from "../prisma-session-assembly-authorities.js";
import { PrismaSkillRevisionEligibilitySource } from "../prisma-skill-revision-eligibility-source.js";

describe("Prisma session assembly authority factories", function _DescribePrismaSessionAssemblyAuthorityFactories()
{
	it("selects explicit empty personal-memory inputs for managed composition", async function _ComposesManagedAuthorities()
	{
		const authorities = __CreatePrismaManagedSessionAssemblyAuthorities({ admit: async function _Admit() { throw new Error("not invoked"); } } as never, { load: async function _Load() { return { outcome: "denied", reason: "identity_unavailable" } as const; } } as never, new PrismaSkillRevisionEligibilitySource());
		expect(authorities.memoryScope).toBeInstanceOf(ManagedNoPersonalMemoryScopeSource);
		await expect(authorities.preferenceFacts.load({} as never, {} as never, {} as never, {} as never)).resolves.toEqual({ outcome: "loaded", value: [] });
	});

	it("composes verified personal dataset and content-free preference sources for personal admission", async function _ComposesPersonalAuthorities()
	{
		const transaction = {
			prisma: {
				memoryDataset: { findFirst: vi.fn().mockResolvedValue({ id: "dataset-1", cogneeDatasetId: "cognee-dataset-1" }) },
				memoryFactCatalog: { findMany: vi.fn().mockResolvedValue([{ id: "fact-1", provenance: { sourceKind: MemoryFactProvenanceSourceKinds.ExplicitUserFact, sourceUserId: "user-1" } }]) },
			},
		};
		const authorities = __CreatePrismaPersonalSessionAssemblyAuthorities({ admit: async function _Admit() { throw new Error("not invoked"); } } as never, { load: async function _Load() { return { outcome: "denied", reason: "identity_unavailable" } as const; } } as never, new PrismaSkillRevisionEligibilitySource());
		const command = { siloId: "silo-1" } as never;
		const run = { agentKind: "personal" } as never;
		const identity = { kind: "user", organizationId: "org-1", executionSubjectId: "user-1" } as never;

		expect(authorities.memoryScope).toBeInstanceOf(PersonalMemoryScopeSource);
		await expect(authorities.memoryScope.load(command, run, identity, transaction as never)).resolves.toEqual({ outcome: "loaded", value: { memoryQueryPolicy: { scope: "personal", datasetId: "dataset-1", cogneeDatasetId: "cognee-dataset-1" }, memoryFacts: [] } });
		await expect(authorities.preferenceFacts.load(command, run, identity, transaction as never)).resolves.toEqual({ outcome: "loaded", value: [{ id: "fact-1" }] });
		expect(transaction.prisma.memoryFactCatalog.findMany).toHaveBeenCalledWith(expect.objectContaining({ select: { id: true, provenance: true } }));
	});
});
