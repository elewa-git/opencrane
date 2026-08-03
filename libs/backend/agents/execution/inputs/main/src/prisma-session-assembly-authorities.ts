import type { RunAdmissionRepository } from "@opencrane/backend/agents/execution/runs";

import { ManagedMemoryScopeSource } from "./managed-memory-scope-source.js";
import { PrismaApprovedPersonaSource } from "./prisma-approved-persona-source.js";
import { PrismaPreferenceFactSource } from "./prisma-preference-fact-source.js";
import { PrismaRevisionBudgetPolicySource, PrismaRevisionToolPolicySource } from "./prisma-revision-tool-policy-source.js";
import { PrismaRunAuthoritySource } from "./prisma-run-authority-source.js";
import { PrismaThreadContextSource } from "./prisma-thread-context-source.js";
import type { IdentityEnvelopeSource, SessionAssemblyAuthorities, SkillRevisionEligibilitySource } from "./session-assembly.types.js";

/** Composes the managed-service variant with catalogued attached-memory scopes and injectable identity proof. */
export function __CreatePrismaManagedSessionAssemblyAuthorities(admission: RunAdmissionRepository, identityEnvelope: IdentityEnvelopeSource, skillEligibility: SkillRevisionEligibilitySource): SessionAssemblyAuthorities
{
	return {
		admission,
		runAuthority: new PrismaRunAuthoritySource(),
		approvedPersona: new PrismaApprovedPersonaSource(),
		threadContext: new PrismaThreadContextSource(),
		preferenceFacts: new PrismaPreferenceFactSource(),
		memoryScope: new ManagedMemoryScopeSource(),
		toolPolicy: new PrismaRevisionToolPolicySource(),
		skillEligibility,
		budgetPolicy: new PrismaRevisionBudgetPolicySource(),
		identityEnvelope,
	};
}
