import { describe, expect, it } from "vitest";

import { ManagedMemoryScopeSource } from "../managed-memory-scope-source.js";
import { __CreatePrismaManagedSessionAssemblyAuthorities } from "../prisma-session-assembly-authorities.js";
import { PrismaSkillRevisionEligibilitySource } from "../prisma-skill-revision-eligibility-source.js";

describe("Prisma session assembly authority factories", function _DescribePrismaSessionAssemblyAuthorityFactories()
{
	it("selects the catalogued attached-memory policy for managed composition", function _ComposesManagedAuthorities()
	{
		const authorities = __CreatePrismaManagedSessionAssemblyAuthorities({ admit: async function _Admit() { throw new Error("not invoked"); } } as never, { load: async function _Load() { return { outcome: "denied", reason: "identity_unavailable" } as const; } } as never, new PrismaSkillRevisionEligibilitySource());
		expect(authorities.memoryScope).toBeInstanceOf(ManagedMemoryScopeSource);
	});
});
