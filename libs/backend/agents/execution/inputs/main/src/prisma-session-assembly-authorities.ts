import type { Prisma } from "@prisma/client";

import type { RunAdmissionRepository, RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";
import { PrismaPersonalMemoryAdmissionRepository } from "@opencrane/backend/agents/personal/memory";

import { ManagedNoPersonalMemoryScopeSource } from "./managed-no-personal-memory-scope-source";
import { PersonalMemoryPreferenceFactSource } from "./personal-memory-preference-fact-source";
import { PersonalMemoryScopeSource } from "./personal-memory-scope-source";
import { PrismaApprovedPersonaSource } from "./prisma-approved-persona-source";
import { PrismaMcpToolAdmissionClaimRepository } from "./prisma-mcp-tool-admission-claim-repository";
import { PrismaRevisionBudgetPolicySource, PrismaRevisionToolPolicySource } from "./prisma-revision-tool-policy-source";
import { PrismaRunAuthoritySource } from "./prisma-run-authority-source";
import { PrismaConversationContextRepository } from "./prisma-conversation-context-repository";
import { TransactionBoundConversationContextSource } from "./prisma-conversation-context-source";
import type { IdentityEnvelopeSource, SessionAssemblyAuthorities, SkillRevisionEligibilitySource } from "./session-assembly.types";

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
		toolPolicy: new PrismaRevisionToolPolicySource(_CreateMcpToolAdmissionClaimRepository),
		skillEligibility,
		budgetPolicy: new PrismaRevisionBudgetPolicySource(),
		identityEnvelope,
	};
}

/**
 * Composes the personal-run variant with transaction-scoped memory-coordinate readers.
 *
 * The caller supplies the user identity and skill-eligibility authorities because their signed
 * membership and grant policies remain owned elsewhere. This factory owns only the otherwise easy
 * to miss link between personal session assembly and identity-bound memory selection: both the
 * frozen Cognee dataset coordinate, bounded query, and content-free preference identifiers are
 * read through adapters bound to the same admission transaction. Recall remains unreachable until
 * the declared memory tool obtains an exact accepted permission receipt.
 */
export function __CreatePrismaPersonalSessionAssemblyAuthorities(admission: RunAdmissionRepository, identityEnvelope: IdentityEnvelopeSource, skillEligibility: SkillRevisionEligibilitySource): SessionAssemblyAuthorities
{
	// Keep all common session inputs identical to managed admission; only personal identity-scoped inputs differ.
	return {
		admission,
		runAuthority: new PrismaRunAuthoritySource(),
		approvedPersona: new PrismaApprovedPersonaSource(),
		conversationContext: new TransactionBoundConversationContextSource(_CreateConversationContextRepository),
		preferenceFacts: new PersonalMemoryPreferenceFactSource(_CreatePersonalMemory),
		memoryScope: new PersonalMemoryScopeSource(_CreatePersonalMemory),
		toolPolicy: new PrismaRevisionToolPolicySource(_CreateMcpToolAdmissionClaimRepository),
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

/** Bind the MCP admission claim to the exact final-admission transaction. */
function _CreateMcpToolAdmissionClaimRepository(transaction: RunAdmissionTransaction): PrismaMcpToolAdmissionClaimRepository
{
	return new PrismaMcpToolAdmissionClaimRepository(transaction.prisma);
}
