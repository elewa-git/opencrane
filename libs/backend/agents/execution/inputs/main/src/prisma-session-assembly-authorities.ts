import type { Prisma } from "@prisma/client";

import type { RunAdmissionRepository, RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";
import { PrismaPersonalMemoryAdmissionRepository } from "@opencrane/backend/agents/personal/memory";

import { ManagedNoPersonalMemoryScopeSource } from "./managed-no-personal-memory-scope-source.js";
import { PersonalMemoryPreferenceFactSource } from "./personal-memory-preference-fact-source.js";
import { PersonalMemoryScopeSource } from "./personal-memory-scope-source.js";
import { PrismaApprovedPersonaSource } from "./prisma-approved-persona-source.js";
import { PrismaRevisionBudgetPolicySource, PrismaRevisionToolPolicySource } from "./prisma-revision-tool-policy-source.js";
import { PrismaRunAuthoritySource } from "./prisma-run-authority-source.js";
import { PrismaThreadContextSource } from "./prisma-thread-context-source.js";
import type { PersonalMemoryFactSelector } from "./memory-fact-selector.types.js";
import type { IdentityEnvelopeSource, SessionAssemblyAuthorities, SkillRevisionEligibilitySource } from "./session-assembly.types.js";

/** Composes the managed-service variant with an explicit empty personal-memory policy and injectable identity proof. */
export function __CreatePrismaManagedSessionAssemblyAuthorities(admission: RunAdmissionRepository, identityEnvelope: IdentityEnvelopeSource, skillEligibility: SkillRevisionEligibilitySource): SessionAssemblyAuthorities
{
	return {
		admission,
		runAuthority: new PrismaRunAuthoritySource(),
		approvedPersona: new PrismaApprovedPersonaSource(),
		threadContext: new PrismaThreadContextSource(),
		preferenceFacts: { load: async function _LoadManagedEmptyPreferences() { return { outcome: "loaded", value: [] }; } },
		memoryScope: new ManagedNoPersonalMemoryScopeSource(),
		toolPolicy: new PrismaRevisionToolPolicySource(),
		skillEligibility,
		budgetPolicy: new PrismaRevisionBudgetPolicySource(),
		identityEnvelope,
	};
}

/**
 * Composes the personal-run variant with transaction-scoped memory readers and gateway recall.
 *
 * The caller supplies the user identity and skill-eligibility authorities because their signed
 * membership and grant policies remain owned elsewhere. This factory owns only the otherwise easy
 * to miss link between personal session assembly and identity-bound memory selection: both the
 * frozen Cognee dataset coordinate and content-free preference identifiers are read through
 * adapters bound to the same admission transaction, while the injected selector freezes only
 * gateway-authorized fact references from that exact dataset.
 */
export function __CreatePrismaPersonalSessionAssemblyAuthorities(admission: RunAdmissionRepository, identityEnvelope: IdentityEnvelopeSource, skillEligibility: SkillRevisionEligibilitySource, memoryFactSelector: PersonalMemoryFactSelector): SessionAssemblyAuthorities
{
	// Keep all common session inputs identical to managed admission; only personal identity-scoped inputs differ.
	return {
		admission,
		runAuthority: new PrismaRunAuthoritySource(),
		approvedPersona: new PrismaApprovedPersonaSource(),
		threadContext: new PrismaThreadContextSource(),
		preferenceFacts: new PersonalMemoryPreferenceFactSource(_CreatePersonalMemory),
		memoryScope: new PersonalMemoryScopeSource(_CreatePersonalMemory, memoryFactSelector),
		toolPolicy: new PrismaRevisionToolPolicySource(),
		skillEligibility,
		budgetPolicy: new PrismaRevisionBudgetPolicySource(),
		identityEnvelope,
	};
}

/** Bind each personal-memory reader to the exact final-admission transaction. */
function _CreatePersonalMemory(transaction: RunAdmissionTransaction): PrismaPersonalMemoryAdmissionRepository
{
	return new PrismaPersonalMemoryAdmissionRepository(transaction.prisma as Prisma.TransactionClient);
}
