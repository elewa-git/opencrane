import type { Prisma } from "@prisma/client";

import { __AssembleRunInputSnapshot, __CompileRunInput, __CreatePrismaSessionAssemblyAuthorities, PersonalConversationExecutionSubjectAuthority, PrismaPromptCompilerRepository, PrismaPromptCompilerUnitOfWork, SessionAssemblyOutcomes, VerifiedConversationPromptMessageRepository } from "@opencrane/backend/agents/execution/inputs";
import { PrismaRunAdmissionUnitOfWork, RunAdmissionConcurrencyGate, RunAdmissionConcurrencyOutcomes, RunAdmissionMessageInputModes } from "@opencrane/backend/agents/execution/runs";
import { AesGcmConversationPrivatePayloadCipher, ConversationComputerHistory, KurrentConversationHistoryAdmissionReader, PrismaKurrentConversationPromptMessageRepository, type ConversationComputerRunAdmissionCommand, type ConversationComputerRunAdmissionPort } from "@opencrane/backend/server/conversations";
import { PersonalExecutionEvidenceAuthority, PrismaPersonalExecutionEvidenceRepository } from "@opencrane/backend/server/agents/agent-services";
import { AgentIdentityHistory } from "@opencrane/backend/server/iam/identity";
import { _CreateFleetMembershipEvidenceConfig, type FleetMembershipEvidenceConfig } from "@opencrane/backend/server/iam/membership";
import type { HistoryStore } from "@opencrane/backend/server/infra/history-store";

import type { RunAdmissionCapacityConfig } from "./config.types";
import { _ReadConversationPrivatePayloadKeyring } from "./conversation-history-composition";
import { _log } from "./log";
import type { ConversationRunExecutionSubjectAuthorityFactory, ConversationRunHistoryAdmissionReaderFactory, ConversationRunInputCompilerRepositoryFactory, PersonalConversationRunAuthorities } from "./run-admission-composition.types";

/**
 * Compose the complete personal ConversationComputer admission port from production authorities.
 *
 * Called by: the OpenCrane process entrypoint before it creates the private computer router.
 * @see _CreateConversationRunAdmission for capacity and transaction sequencing.
 */
export function _CreatePersonalConversationRunAdmission(prisma: ConstructorParameters<typeof PrismaRunAdmissionUnitOfWork>[0], history: HistoryStore, keyringPath: string, policy: RunAdmissionCapacityConfig): ConversationComputerRunAdmissionPort
{
	const authorities = _CreatePersonalConversationRunAuthorities(history, _CreateFleetMembershipEvidenceConfig());
	const cipher = AesGcmConversationPrivatePayloadCipher.fromDocument(_ReadConversationPrivatePayloadKeyring(keyringPath));
	function _CreateMessages(command: ConversationComputerRunAdmissionCommand, transaction: Prisma.TransactionClient): VerifiedConversationPromptMessageRepository
	{
		const source = new PrismaKurrentConversationPromptMessageRepository(transaction, history, cipher, command.siloId, command.conversationId, command.messageInput.historyRevision);
		return new VerifiedConversationPromptMessageRepository(source);
	}
	const compilers: ConversationRunInputCompilerRepositoryFactory = {
		create: function _CreateCompiler(command, transaction) { return new PrismaPromptCompilerRepository(transaction, _CreateMessages(command, transaction), command.siloId); },
		compile: function _CompileIdempotent(command, snapshot)
		{
			const compiler = new PrismaPromptCompilerUnitOfWork(prisma, function _CreateIdempotentMessages(transaction) { return _CreateMessages(command, transaction); });
			return compiler.compile(snapshot, snapshot.attempt);
		},
	};
	return _CreateConversationRunAdmission(prisma, authorities.executionSubjects, authorities.histories, compilers, policy);
}

/** Build transaction-bound personal evidence and exact Kurrent history authorities for admission. */
function _CreatePersonalConversationRunAuthorities(history: HistoryStore, membership: FleetMembershipEvidenceConfig): PersonalConversationRunAuthorities
{
	const identityHistory = new AgentIdentityHistory(history);
	const computerHistory = new ConversationComputerHistory(history);
	const conversationHistory = new KurrentConversationHistoryAdmissionReader(history);
	return {
		executionSubjects: { create: function _CreateExecutionSubject(command: ConversationComputerRunAdmissionCommand)
		{
			return new PersonalConversationExecutionSubjectAuthority({
				coordinates: command,
				identityHistory,
				computerHistory,
				executionEvidence: function _CreateExecutionEvidence(transaction)
				{
					const repository = new PrismaPersonalExecutionEvidenceRepository(transaction.prisma as Prisma.TransactionClient, membership);
					return new PersonalExecutionEvidenceAuthority(repository);
				},
			});
		} },
		histories: { create: function _CreateConversationHistory() { return conversationHistory; } },
	};
}

/** Compose one process-wide admission queue around the canonical run and snapshot transaction owner. */
export function _CreateConversationRunAdmission(prisma: ConstructorParameters<typeof PrismaRunAdmissionUnitOfWork>[0], executionSubjects: ConversationRunExecutionSubjectAuthorityFactory, histories: ConversationRunHistoryAdmissionReaderFactory, compilers: ConversationRunInputCompilerRepositoryFactory, policy: RunAdmissionCapacityConfig): ConversationComputerRunAdmissionPort
{
	const concurrency = new RunAdmissionConcurrencyGate(policy);
	const persistence = new PrismaRunAdmissionUnitOfWork(prisma, undefined, _log);
	return {
		admit: async function _AdmitConversationRun(command: ConversationComputerRunAdmissionCommand)
		{
			let compiled;
			const admission = {
				runId: command.runId,
				siloId: command.siloId,
				agentServiceId: command.agentServiceId,
				conversationId: command.conversationId,
				requestIdempotencyKey: command.requestIdempotencyKey,
				messageInput: {
					...command.messageInput,
					mode: RunAdmissionMessageInputModes.PrePersistedHistory,
					author: { principalId: command.requesterPrincipalId, issuer: command.requesterIssuer, subjectId: command.requesterSubjectId, authenticatedAt: command.requesterAuthenticatedAt },
				},
				trigger: "interactive" as const,
				requester: { subjectId: command.requesterSubjectId, issuer: command.requesterIssuer, authenticatedAt: command.requesterAuthenticatedAt },
			};
			const result = await concurrency.execute(admission, async function _AssembleWithinCapacity()
			{
				const authorities = __CreatePrismaSessionAssemblyAuthorities(persistence, executionSubjects.create(command), histories.create(command));
				return await __AssembleRunInputSnapshot(admission, authorities, async function _CompileBeforeCommit(transaction, value)
				{
					compiled = await __CompileRunInput(value.snapshot, value.snapshot.attempt, compilers.create(command, transaction.prisma as Prisma.TransactionClient));
				});
			});
			if (result.outcome === RunAdmissionConcurrencyOutcomes.Rejected)
				throw new Error("Conversation run admission capacity is exhausted");
			if (result.value.outcome === SessionAssemblyOutcomes.Denied)
				throw new Error(`Conversation run admission was denied: ${result.value.reason}`);
			if (command.agentRevisionId !== result.value.snapshot.agentRevisionId)
				throw new Error("Conversation run admission selected another agent revision");
			return compiled ?? await compilers.compile(command, result.value.snapshot);
		},
	};
}
