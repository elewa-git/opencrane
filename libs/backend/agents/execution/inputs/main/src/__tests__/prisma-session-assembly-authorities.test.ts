import { describe, expect, it } from "vitest";

import { __CreatePrismaSessionAssemblyAuthorities } from "../prisma-session-assembly-authorities.js";
import { PrismaApprovedPersonaSource } from "../prisma-approved-persona-source.js";
import { PrismaMemoryScopeSource } from "../prisma-memory-scope-source.js";
import { PrismaPreferenceFactSource } from "../prisma-preference-fact-source.js";
import { PrismaRevisionBudgetPolicySource, PrismaRevisionToolPolicySource } from "../prisma-revision-tool-policy-source.js";
import { PrismaRunAuthoritySource } from "../prisma-run-authority-source.js";
import { PrismaThreadContextSource } from "../prisma-thread-context-source.js";
import type { IdentityEnvelopeSource } from "../session-assembly.types.js";

describe("__CreatePrismaSessionAssemblyAuthorities", function _DescribePrismaSessionAssemblyAuthorities()
{
	it("composes every local source but preserves app ownership of signed identity evidence", function _ComposesAuthorities()
	{
		const admission = { admit: async function _admit() { throw new Error("not invoked"); } } as never;
		const identityEnvelope: IdentityEnvelopeSource = { load: async function _load() { return { outcome: "denied", reason: "identity_unavailable" }; } };
		const authorities = __CreatePrismaSessionAssemblyAuthorities(admission, identityEnvelope);

		expect(authorities.admission).toBe(admission);
		expect(authorities.identityEnvelope).toBe(identityEnvelope);
		expect(authorities.runAuthority).toBeInstanceOf(PrismaRunAuthoritySource);
		expect(authorities.approvedPersona).toBeInstanceOf(PrismaApprovedPersonaSource);
		expect(authorities.threadContext).toBeInstanceOf(PrismaThreadContextSource);
		expect(authorities.preferenceFacts).toBeInstanceOf(PrismaPreferenceFactSource);
		expect(authorities.memoryScope).toBeInstanceOf(PrismaMemoryScopeSource);
		expect(authorities.toolPolicy).toBeInstanceOf(PrismaRevisionToolPolicySource);
		expect(authorities.budgetPolicy).toBeInstanceOf(PrismaRevisionBudgetPolicySource);
	});
});
