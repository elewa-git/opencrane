import type { Prisma } from "@prisma/client";

import { ManagedRoutineExecutionSubjectAuthority, PrismaPromptCompilerRepository, VerifiedConversationPromptMessageRepository, type ExecutionSubjectAuthority } from "@opencrane/backend/agents/execution/inputs";
import type { RoutineRunAdmissionCommand } from "@opencrane/backend/agents/execution/runs";
import { ManagedExecutionEvidenceAuthority, PrismaManagedExecutionEvidenceRepository } from "@opencrane/backend/server/agents/agent-services";
import { ConversationComputerHistory, _ComputerScopeOf, _LeaseScopeOf, type CurrentConversationComputer } from "@opencrane/backend/server/conversations/computers";
import { AgentIdentityHistory } from "@opencrane/backend/server/iam/identity";

import { PrismaRoutineOccurrencePromptMessageRepository } from "./prisma-routine-occurrence-prompt-message-repository";
import { RoutineOccurrencePromptHistoryReader } from "./routine-occurrence-prompt-history-reader";
import type { RoutineOccurrenceHistoryRecord } from "./routine-occurrence-history.types";
import type { RoutineRunAdmissionDependencies } from "./routine-run-admission.types";
import { PrismaConversationComputerTurnWorkflowReceiptRepository } from "../computers/turns/workflow/prisma-conversation-computer-turn-workflow-receipt-repository";

/** Creates the managed subject after the admission owner selects the current published revision. */
export function _RoutineExecutionSubject(dependencies: Pick<RoutineRunAdmissionDependencies, "history" | "membership">, record: RoutineOccurrenceHistoryRecord, command: RoutineRunAdmissionCommand, current: CurrentConversationComputer): ExecutionSubjectAuthority
{
	const lease = current.lease;
	if (lease === null)
		throw new Error("Routine run requires its active computer lease");
	const identityHistory = new AgentIdentityHistory(dependencies.history);
	const computerHistory = new ConversationComputerHistory(dependencies.history);
	return {
		load: async function _LoadSubject(input, run, transaction)
		{
			const coordinates = { runId: command.runId, computer: _ComputerScopeOf(current.computer), agent: { agentServiceId: record.agentServiceId, agentRevisionId: run.agentRevisionId, profileRevisionId: record.profileRevisionId }, lease: { ..._LeaseScopeOf(lease), sandboxClaimId: lease.sandboxClaimId }, requestIdempotencyKey: command.requestIdempotencyKey, routine: command.routineInput };
			const authority = new ManagedRoutineExecutionSubjectAuthority({
				coordinates, identityHistory, computerHistory,
				executionEvidence: function _Evidence(context)
				{
					const repository = new PrismaManagedExecutionEvidenceRepository(context.prisma as Prisma.TransactionClient, dependencies.membership);
					return new ManagedExecutionEvidenceAuthority(repository);
				},
				resolvePrincipalId: async function _Principal(context)
				{
					const repository = new PrismaManagedExecutionEvidenceRepository(context.prisma as Prisma.TransactionClient, dependencies.membership);
					return (await repository.loadCurrent(record.siloId, record.agentServiceId))?.principalId ?? null;
				},
			});
			return authority.load(input, run, transaction);
		},
	};
}

/** Compiles only the first attested routine instruction; no arbitrary service message gains user authority. */
export function _RoutinePromptCompiler(transaction: Prisma.TransactionClient, dependencies: Pick<RoutineRunAdmissionDependencies, "occurrences" | "cipher">, command: RoutineRunAdmissionCommand): PrismaPromptCompilerRepository
{
	const history = new RoutineOccurrencePromptHistoryReader(dependencies.occurrences);
	if (command.conversationId === null)
		throw new Error("Routine prompt compilation requires its occurrence conversation");
	const query = { siloId: command.siloId, conversationId: command.conversationId, agentServiceId: command.agentServiceId, trigger: command.trigger, routine: command.routineInput };
	const source = new PrismaRoutineOccurrencePromptMessageRepository(transaction, history, dependencies.cipher, query, "1");
	return new PrismaPromptCompilerRepository(transaction, new VerifiedConversationPromptMessageRepository(source), command.siloId);
}

/** Binds the shared receipt adapter to the run owner's commit callback transaction. */
export function _RoutineTurnReceipts(transaction: Prisma.TransactionClient): PrismaConversationComputerTurnWorkflowReceiptRepository
{
	return new PrismaConversationComputerTurnWorkflowReceiptRepository(transaction);
}
