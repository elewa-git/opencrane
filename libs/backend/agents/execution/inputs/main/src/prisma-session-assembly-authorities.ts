import type { Prisma } from "@prisma/client";

import type { InitialRunAuthority, RunAdmissionRepository, RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";
import { PrismaPersonalMemoryAdmissionRepository } from "@opencrane/backend/agents/personal/memory";
import type { ExecutionSubject } from "@opencrane/models/agents";

import { PersonalMemoryPreferenceFactSource } from "./personal-memory-preference-fact-source";
import { PersonalMemoryScopeSource } from "./personal-memory-scope-source";
import { PrismaApprovedPersonaAuthority } from "./prisma-approved-persona-source";
import { PrismaConversationContextRepository } from "./prisma-conversation-context-repository";
import { TransactionBoundConversationContextSource } from "./prisma-conversation-context-source";
import { PrismaRevisionBudgetPolicyAuthority, PrismaRevisionToolPolicyAuthority } from "./prisma-revision-tool-policy-source";
import { PrismaRunAuthority } from "./prisma-run-authority-source";
import { PrismaSkillRevisionEligibilityRepository, PrismaSkillRevisionEligibilitySource } from "./prisma-skill-revision-eligibility-source";
import { TransactionBoundProductResourceAuthorizationSource } from "./product-resource-authorization-source";
import { RunPolicyMemoryScopeSource } from "./run-policy-memory-scope-source";
import type { ApprovedPersonaInput, ApprovedPersonaSource, BudgetPolicySource, ConversationHistoryAdmissionReader, ExecutionSubjectAuthority, RunAuthoritySource, SessionAssemblyAuthorities, SessionAssemblyCommand, SessionAssemblyLoad, ToolPolicySource } from "./session-assembly.types";

/** Composes the target input authorities around one mandatory verified execution subject source. */
export function __CreatePrismaSessionAssemblyAuthorities(admission: RunAdmissionRepository, executionSubject: ExecutionSubjectAuthority, conversationHistory: ConversationHistoryAdmissionReader): SessionAssemblyAuthorities
{
	const personalMemoryScope = new PersonalMemoryScopeSource(_CreatePersonalMemory);
	return {
		admission,
		runAuthority: new TransactionBoundRunAuthoritySource(),
		approvedPersona: new TransactionBoundApprovedPersonaSource(),
		conversationContext: new TransactionBoundConversationContextSource(function _CreateConversationContext(transaction): PrismaConversationContextRepository { return _CreateConversationContextRepository(transaction, conversationHistory); }),
		preferenceFacts: new PersonalMemoryPreferenceFactSource(_CreatePersonalMemory),
		memoryScope: new RunPolicyMemoryScopeSource(personalMemoryScope),
		toolPolicy: new TransactionBoundRevisionToolPolicySource(),
		skillEligibility: new PrismaSkillRevisionEligibilitySource(_CreateSkillRevisionEligibilityRepository),
		productAuthorization: new TransactionBoundProductResourceAuthorizationSource(),
		budgetPolicy: new TransactionBoundRevisionBudgetPolicySource(),
		executionSubject,
	};
}

/** Binds each run-authority read to the active admission transaction. */
class TransactionBoundRunAuthoritySource implements RunAuthoritySource
{
	async load(command: SessionAssemblyCommand, transaction: RunAdmissionTransaction): Promise<SessionAssemblyLoad<InitialRunAuthority>>
	{
		return new PrismaRunAuthority(transaction.prisma as Prisma.TransactionClient).load(command, transaction);
	}
}

/** Binds each persona-authority read to the active admission transaction. */
class TransactionBoundApprovedPersonaSource implements ApprovedPersonaSource
{
	async load(command: SessionAssemblyCommand, run: InitialRunAuthority, executionSubject: ExecutionSubject, transaction: RunAdmissionTransaction): Promise<SessionAssemblyLoad<ApprovedPersonaInput>>
	{
		return new PrismaApprovedPersonaAuthority(transaction.prisma as Prisma.TransactionClient).load(command, run, executionSubject, transaction);
	}
}

/** Binds each personal-memory reader to the exact final-admission transaction. */
function _CreatePersonalMemory(transaction: RunAdmissionTransaction): PrismaPersonalMemoryAdmissionRepository
{
	return new PrismaPersonalMemoryAdmissionRepository(transaction.prisma as Prisma.TransactionClient);
}

/** Binds the conversation reader to the exact final-admission transaction. */
function _CreateConversationContextRepository(transaction: RunAdmissionTransaction, history: ConversationHistoryAdmissionReader): PrismaConversationContextRepository
{
	return new PrismaConversationContextRepository(transaction.prisma as Prisma.TransactionClient, history);
}

/** Binds tool-policy reads to the active admission transaction. */
class TransactionBoundRevisionToolPolicySource implements ToolPolicySource
{
	async load(command: Parameters<ToolPolicySource["load"]>[0], run: Parameters<ToolPolicySource["load"]>[1], transaction: Parameters<ToolPolicySource["load"]>[2])
	{
		return new PrismaRevisionToolPolicyAuthority(transaction.prisma as Prisma.TransactionClient).load(command, run, transaction);
	}
}

/** Binds budget-policy reads to the active admission transaction. */
class TransactionBoundRevisionBudgetPolicySource implements BudgetPolicySource
{
	async load(command: Parameters<BudgetPolicySource["load"]>[0], run: Parameters<BudgetPolicySource["load"]>[1], transaction: Parameters<BudgetPolicySource["load"]>[2])
	{
		return new PrismaRevisionBudgetPolicyAuthority(transaction.prisma as Prisma.TransactionClient).load(command, run, transaction);
	}
}

/** Binds the skill eligibility reader to the exact final-admission transaction. */
function _CreateSkillRevisionEligibilityRepository(transaction: RunAdmissionTransaction): PrismaSkillRevisionEligibilityRepository
{
	return new PrismaSkillRevisionEligibilityRepository(transaction.prisma as Prisma.TransactionClient);
}
