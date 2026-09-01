import type { Prisma } from "@prisma/client";

import type { RunAdmissionRepository, RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";
import { PrismaPersonalMemoryAdmissionRepository } from "@opencrane/backend/agents/personal/memory";

import { PersonalMemoryPreferenceFactSource } from "./personal-memory-preference-fact-source";
import { PersonalMemoryScopeSource } from "./personal-memory-scope-source";
import { PrismaApprovedPersonaSource } from "./prisma-approved-persona-source";
import { PrismaConversationContextRepository } from "./prisma-conversation-context-repository";
import { TransactionBoundConversationContextSource } from "./prisma-conversation-context-source";
import { PrismaMcpToolAdmissionClaimRepository } from "./prisma-mcp-tool-admission-claim-repository";
import { PrismaRevisionBudgetPolicySource, PrismaRevisionToolPolicySource } from "./prisma-revision-tool-policy-source";
import { PrismaRunAuthoritySource } from "./prisma-run-authority-source";
import { PrismaSkillRevisionEligibilityRepository, PrismaSkillRevisionEligibilitySource } from "./prisma-skill-revision-eligibility-source";
import { TransactionBoundProductResourceAuthorizationSource } from "./product-resource-authorization-source";
import { RunPolicyMemoryScopeSource } from "./run-policy-memory-scope-source";
import type { ExecutionSubjectAuthority, SessionAssemblyAuthorities } from "./session-assembly.types";

/** Composes the target input authorities around one mandatory verified execution subject source. */
export function __CreatePrismaSessionAssemblyAuthorities(admission: RunAdmissionRepository, executionSubject: ExecutionSubjectAuthority): SessionAssemblyAuthorities
{
	const personalMemoryScope = new PersonalMemoryScopeSource(_CreatePersonalMemory);
	return {
		admission,
		runAuthority: new PrismaRunAuthoritySource(),
		approvedPersona: new PrismaApprovedPersonaSource(),
		conversationContext: new TransactionBoundConversationContextSource(_CreateConversationContextRepository),
		preferenceFacts: new PersonalMemoryPreferenceFactSource(_CreatePersonalMemory),
		memoryScope: new RunPolicyMemoryScopeSource(personalMemoryScope),
		toolPolicy: new PrismaRevisionToolPolicySource(_CreateMcpToolAdmissionClaimRepository),
		skillEligibility: new PrismaSkillRevisionEligibilitySource(_CreateSkillRevisionEligibilityRepository),
		productAuthorization: new TransactionBoundProductResourceAuthorizationSource(),
		budgetPolicy: new PrismaRevisionBudgetPolicySource(),
		executionSubject,
	};
}

/** Binds each personal-memory reader to the exact final-admission transaction. */
function _CreatePersonalMemory(transaction: RunAdmissionTransaction): PrismaPersonalMemoryAdmissionRepository
{
	return new PrismaPersonalMemoryAdmissionRepository(transaction.prisma as Prisma.TransactionClient);
}

/** Binds the conversation reader to the exact final-admission transaction. */
function _CreateConversationContextRepository(transaction: RunAdmissionTransaction): PrismaConversationContextRepository
{
	return new PrismaConversationContextRepository(transaction.prisma);
}

/** Binds the MCP admission claim to the exact final-admission transaction. */
function _CreateMcpToolAdmissionClaimRepository(transaction: RunAdmissionTransaction): PrismaMcpToolAdmissionClaimRepository
{
	return new PrismaMcpToolAdmissionClaimRepository(transaction.prisma);
}

/** Binds the skill eligibility reader to the exact final-admission transaction. */
function _CreateSkillRevisionEligibilityRepository(transaction: RunAdmissionTransaction): PrismaSkillRevisionEligibilityRepository
{
	return new PrismaSkillRevisionEligibilityRepository(transaction.prisma);
}
