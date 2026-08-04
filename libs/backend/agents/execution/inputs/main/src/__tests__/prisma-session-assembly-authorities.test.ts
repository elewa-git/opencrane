import { describe, expect, it } from "vitest";

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

	it("selects the gateway-backed personal memory scope for personal composition", function _ComposesPersonalAuthorities()
	{
		const authorities = __CreatePrismaPersonalSessionAssemblyAuthorities({ admit: async function _Admit() { throw new Error("not invoked"); } } as never, { load: async function _Load() { return { outcome: "denied", reason: "identity_unavailable" } as const; } } as never, new PrismaSkillRevisionEligibilitySource(), function _CreatePersonalMemory() { return { findActivePersonalDataset: async function _FindActivePersonalDataset() { return null; } }; }, { select: async function _Select() { return []; } });
		expect(authorities.memoryScope).toBeInstanceOf(PersonalMemoryScopeSource);
	});
});
