import type { Prisma } from "@prisma/client";

import type { RunAdmissionRepository, RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";
import { PrismaPersonalMemoryAdmissionRepository } from "@opencrane/backend/agents/personal/memory";

import { ManagedNoPersonalMemoryScopeSource } from "./managed-no-personal-memory-scope-source.js";
import { PersonalMemoryPreferenceFactSource } from "./personal-memory-preference-fact-source.js";
import { PersonalMemoryScopeSource } from "./personal-memory-scope-source.js";
import { PrismaApprovedPersonaSource } from "./prisma-approved-persona-source.js";
import { PrismaRevisionBudgetPolicySource, PrismaRevisionToolPolicySource } from "./prisma-revision-tool-policy-source.js";
import { PrismaRunAuthoritySource } from "./prisma-run-authority-source.js";
import { PrismaConversationContextRepository } from "./prisma-conversation-context-repository.js";
import { TransactionBoundConversationContextSource } from "./prisma-conversation-context-source.js";
import type { PersonalMemoryFactSelector } from "./memory-fact-selector.types.js";
import type { IdentityEnvelopeSource, SessionAssemblyAuthorities, SkillRevisionEligibilitySource } from "./session-assembly.types.js";

/**
 * Builds the managed-service set of input sources.
 *
 * Differs from the personal set in exactly two places: memory is an empty scope, and preferences
 * are always an empty list. Everything else — run authority, persona, conversation, tools, budget —
 * is the same class, so the two paths cannot drift apart on the shared checks.
 *
 * Called by: `__CreateManagedRunAdmissionPort` (execution/admission/main/src/managed-run-admission.composition.ts).
 *
 * @param admission - Opens the admission transaction and saves the run and snapshot.
 * @param identityEnvelope - Supplied by the caller because managed identity evidence is owned by
 * the agent-services package; pass {@link ManagedExecutionIdentityEnvelopeSource}.
 * @param skillEligibility - Supplied by the caller; pass {@link PrismaSkillRevisionEligibilitySource}.
 * @returns The full source set for {@link __AssembleRunInputSnapshot}. Do not mix these with
 * personal sources.
 */
export function __CreatePrismaManagedSessionAssemblyAuthorities(admission: RunAdmissionRepository, identityEnvelope: IdentityEnvelopeSource, skillEligibility: SkillRevisionEligibilitySource): SessionAssemblyAuthorities
{
	return {
		admission,
		runAuthority: new PrismaRunAuthoritySource(),
		approvedPersona: new PrismaApprovedPersonaSource(),
		conversationContext: new TransactionBoundConversationContextSource(_CreateConversationContextRepository),
		preferenceFacts: { load: async function _LoadManagedEmptyPreferences() { return { outcome: "loaded", value: [] }; } },
		memoryScope: new ManagedNoPersonalMemoryScopeSource(),
		toolPolicy: new PrismaRevisionToolPolicySource(),
		skillEligibility,
		budgetPolicy: new PrismaRevisionBudgetPolicySource(),
		identityEnvelope,
	};
}

/**
 * Builds the personal-run set of input sources.
 *
 * The caller supplies the identity and skill-eligibility sources, because signed membership and
 * grant policy are owned elsewhere.
 *
 * The one thing this factory owns — and the easy thing to get wrong — is the link between personal
 * assembly and identity-bound memory: the Cognee dataset id and the preference ids (ids only, no
 * text) are both read through adapters bound to the same admission transaction, and the injected
 * selector takes only fact references the gateway allows from that same dataset. Bind either reader
 * to a different client and the memory a run gets could belong to a state the rest of the snapshot
 * never saw.
 *
 * Called by: `__CreatePersonalRunAdmissionPort` (execution/admission/main/src/personal-run-admission.composition.ts).
 *
 * @param admission - Opens the admission transaction and saves the run and snapshot.
 * @param identityEnvelope - Pass {@link PersonalExecutionIdentityEnvelopeSource}.
 * @param skillEligibility - Pass {@link PrismaSkillRevisionEligibilitySource}.
 * @param memoryFactSelector - The gateway-backed fact selector. It must throw on transport failure;
 * see {@link PersonalMemoryFactSelector}.
 * @returns The full source set for {@link __AssembleRunInputSnapshot}. Do not mix these with
 * managed sources.
 */
export function __CreatePrismaPersonalSessionAssemblyAuthorities(admission: RunAdmissionRepository, identityEnvelope: IdentityEnvelopeSource, skillEligibility: SkillRevisionEligibilitySource, memoryFactSelector: PersonalMemoryFactSelector): SessionAssemblyAuthorities
{
	// Keep all common session inputs identical to managed admission; only personal identity-scoped inputs differ.
	return {
		admission,
		runAuthority: new PrismaRunAuthoritySource(),
		approvedPersona: new PrismaApprovedPersonaSource(),
		conversationContext: new TransactionBoundConversationContextSource(_CreateConversationContextRepository),
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

/** Bind the conversation reader to the exact final-admission transaction. */
function _CreateConversationContextRepository(transaction: RunAdmissionTransaction): PrismaConversationContextRepository
{
	return new PrismaConversationContextRepository(transaction.prisma);
}
