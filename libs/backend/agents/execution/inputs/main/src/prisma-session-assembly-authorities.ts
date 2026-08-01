import type { RunAdmissionRepository } from "@opencrane/backend/agents/execution/runs";
import type { PersonalMemoryAdmissionRepository } from "@opencrane/backend/agents/personal/memory";

import { ManagedNoPersonalMemoryScopeSource } from "./managed-no-personal-memory-scope-source.js";
import { PersonalMemoryScopeSource } from "./personal-memory-scope-source.js";
import { PrismaApprovedPersonaSource } from "./prisma-approved-persona-source.js";
import { PrismaRevisionBudgetPolicySource, PrismaRevisionToolPolicySource } from "./prisma-revision-tool-policy-source.js";
import { PrismaRunAuthoritySource } from "./prisma-run-authority-source.js";
import { PrismaThreadContextSource } from "./prisma-thread-context-source.js";
import type { PersonalMemoryFactSelector } from "./memory-fact-selector.types.js";
import type { IdentityEnvelopeSource, MemoryScopeSource, SessionAssemblyAuthorities, SkillRevisionEligibilitySource } from "./session-assembly.types.js";

/** Composes the managed-service variant with an explicit empty personal-memory policy and injectable identity proof. */
export function __CreatePrismaManagedSessionAssemblyAuthorities(admission: RunAdmissionRepository, identityEnvelope: IdentityEnvelopeSource, skillEligibility: SkillRevisionEligibilitySource): SessionAssemblyAuthorities
{
	return _CreateAuthorities(admission, identityEnvelope, skillEligibility, new ManagedNoPersonalMemoryScopeSource());
}

/**
 * Composes the personal-run variant whose memory scope freezes gateway-selected fact references.
 *
 * The dataset repository resolves the sole personal dataset from verified identity, and the
 * injected selector performs the admission-time gateway recall; the source itself never accepts a
 * caller-provided dataset or fact reference. Only the `agentKind: personal` path may receive this
 * composition — the personal scope source refuses managed runs by construction.
 */
export function __CreatePrismaPersonalSessionAssemblyAuthorities(admission: RunAdmissionRepository, identityEnvelope: IdentityEnvelopeSource, skillEligibility: SkillRevisionEligibilitySource, personalMemory: PersonalMemoryAdmissionRepository, memoryFactSelector: PersonalMemoryFactSelector): SessionAssemblyAuthorities
{
	return _CreateAuthorities(admission, identityEnvelope, skillEligibility, new PersonalMemoryScopeSource(personalMemory, memoryFactSelector));
}

/** Assemble the shared Prisma-backed source set around one variant-selected memory scope authority. */
function _CreateAuthorities(admission: RunAdmissionRepository, identityEnvelope: IdentityEnvelopeSource, skillEligibility: SkillRevisionEligibilitySource, memoryScope: MemoryScopeSource): SessionAssemblyAuthorities
{
	return {
		admission,
		runAuthority: new PrismaRunAuthoritySource(),
		approvedPersona: new PrismaApprovedPersonaSource(),
		threadContext: new PrismaThreadContextSource(),
		preferenceFacts: { load: async function _LoadEmptyPreferences() { return { outcome: "loaded", value: [] }; } },
		memoryScope,
		toolPolicy: new PrismaRevisionToolPolicySource(),
		skillEligibility,
		budgetPolicy: new PrismaRevisionBudgetPolicySource(),
		identityEnvelope,
	};
}
