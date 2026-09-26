import { randomUUID } from "node:crypto";

import type { Prisma } from "@prisma/client";

import { PrismaRoutineOccurrenceActivationRepository, PrismaRoutineOccurrencePreparationRepository, PrismaRoutineOccurrenceRunAdmissionRepository, PrismaRoutineUnitOfWork, RoutineInstructionCipherAdapter, RoutineScheduleStartupRecovery, RoutineTaskAdmission, __CreateRoutineWorkflowDefinitions, type PrismaRoutineUnitOfWorkDependencies, type RoutineIdFactory } from "@opencrane/backend/server/agents/scheduling";
import { PrismaRoutineComputerActivationProjectionUnitOfWork, PrismaRoutineOccurrencePreparationUnitOfWork, PrismaRoutineRunAdmissionUnitOfWork, PrismaRoutineTurnCompilerUnitOfWork, RoutineComputerActivation, RoutineOccurrenceHistory } from "@opencrane/backend/server/conversations";
import { ConversationComputerHistory } from "@opencrane/backend/server/conversations/computers";
import { ConversationHistoryAuthority } from "@opencrane/backend/server/conversations/history";
import { PrismaAuthorizationAuthority, PrismaManagedAuthorizationGrantRepository } from "@opencrane/backend/server/iam/authorization";
import { AgentIdentityHistory } from "@opencrane/backend/server/iam/identity";
import { AgentSandboxClaimAdapter } from "@opencrane/backend/server/infra/agent-sandbox";

import type { RoutineWorkflowComposition, RoutineWorkflowExecutionContext } from "./routine-workflow-composition.types";

/** Creates an opaque firing identifier for one process-composed routine workflow. */
function _FiringId(): string
{
	return randomUUID();
}

/** Creates an independent conversation identifier for one routine occurrence. */
function _ConversationId(): string
{
	return randomUUID();
}

/** Creates a stable routine identifier for future command composition through the same factory. */
function _RoutineId(): string
{
	return randomUUID();
}

/** Creates an immutable routine revision identifier through the process ID source. */
function _RevisionId(): string
{
	return randomUUID();
}

/** Creates a command receipt identifier through the process ID source. */
function _CommandReceiptId(): string
{
	return randomUUID();
}

/**
 * Registers both routine tasks and shares their scheduling, history, authorization and recovery
 * adapters. Product rules remain in their owning libraries; this function only selects adapters.
 */
export function _CreateRoutineWorkflowComposition(context: RoutineWorkflowExecutionContext): RoutineWorkflowComposition
{
	const { prisma, history, customApi, siloId, profile, cipher, membership, workflows } = context;
	const taskAdmission = new RoutineTaskAdmission<Prisma.TransactionClient>(workflows);
	const persistenceDependencies: PrismaRoutineUnitOfWorkDependencies = {
		authorization: function _Authorization(transaction) { return new PrismaAuthorizationAuthority(transaction); },
		managedGrants: function _ManagedGrants(transaction) { return new PrismaManagedAuthorizationGrantRepository(transaction); },
		taskAdmission,
	};
	const persistence = new PrismaRoutineUnitOfWork(prisma, persistenceDependencies);
	const instructionCipher = new RoutineInstructionCipherAdapter(cipher);
	const occurrenceHistory = new RoutineOccurrenceHistory(history, new ConversationHistoryAuthority(history));
	const identityHistory = new AgentIdentityHistory(history);
	const agentDependencies = { identityHistory, membershipConfig: membership, profiles: [{ workloadProfile: profile.profileName, profileRevisionId: profile.profileRevisionId }] };
	const preparationRoutines = function _PreparationRoutines(transaction: Prisma.TransactionClient) { return new PrismaRoutineOccurrencePreparationRepository(transaction, persistenceDependencies); };
	const preparation = new PrismaRoutineOccurrencePreparationUnitOfWork(prisma, { routines: preparationRoutines, agents: agentDependencies, cipher, history: occurrenceHistory });
	const computers = new ConversationComputerHistory(history);
	const activationRoutines = function _ActivationRoutines(transaction: Prisma.TransactionClient) { return new PrismaRoutineOccurrenceActivationRepository(transaction, persistenceDependencies); };
	const activation = new RoutineComputerActivation({
		projections: function _Projections(command, receipt, record) { return new PrismaRoutineComputerActivationProjectionUnitOfWork(prisma, activationRoutines, command, receipt, record, computers); },
		occurrences: occurrenceHistory,
		history,
		claims: new AgentSandboxClaimAdapter(customApi),
		profile,
	});
	const runRoutines = function _RunRoutines(transaction: Prisma.TransactionClient) { return new PrismaRoutineOccurrenceRunAdmissionRepository(transaction, persistenceDependencies); };
	const runDependencies = { prisma, routines: runRoutines, occurrences: occurrenceHistory, history, cipher, membership, workflows };
	const runAdmission = new PrismaRoutineRunAdmissionUnitOfWork(runDependencies);
	const ids: RoutineIdFactory = { routineId: _RoutineId, revisionId: _RevisionId, commandReceiptId: _CommandReceiptId, firingId: _FiringId, conversationId: _ConversationId };
	const definitions = __CreateRoutineWorkflowDefinitions({ persistence, cipher: instructionCipher, preparation, activation, runAdmission, ids });
	workflows.register(definitions.schedule);
	workflows.register(definitions.occurrence);
	const dispatcher = new PrismaRoutineTurnCompilerUnitOfWork(prisma, { routines: runRoutines, occurrences: occurrenceHistory, history, cipher, membership, maximumTurnCostUsdMicros: profile.maximumTurnCostUsdMicros });
	const startup = new RoutineScheduleStartupRecovery(persistence, siloId);
	return { dispatcher, startup };
}
