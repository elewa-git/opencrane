import type { Prisma } from "@prisma/client";

import { __AssembleRunInputSnapshot } from "@opencrane/backend/agents/execution/inputs";
import { __CompileRunInput } from "@opencrane/backend/agents/execution/inputs";
import { __RunInputAuthorityExpiresAt } from "@opencrane/backend/agents/execution/inputs";
import { __CreatePrismaSessionAssemblyAuthorities } from "@opencrane/backend/agents/execution/inputs";
import { PersonalConversationExecutionSubjectAuthority } from "@opencrane/backend/agents/execution/inputs";
import { ManagedConversationExecutionSubjectAuthority } from "@opencrane/backend/agents/execution/inputs";
import { PrismaConversationExecutionSubjectAuthority } from "@opencrane/backend/agents/execution/inputs";
import { PrismaPromptCompilerRepository, PrismaPromptCompilerUnitOfWork } from "@opencrane/backend/agents/execution/inputs";
import { SessionAssemblyOutcomes } from "@opencrane/backend/agents/execution/inputs";
import { VerifiedConversationPromptMessageRepository } from "@opencrane/backend/agents/execution/inputs";
import type { ExecutionSubjectAuthority } from "@opencrane/backend/agents/execution/inputs";
import { PrismaRunAdmissionUnitOfWork, RunAdmissionConcurrencyGate, RunAdmissionConcurrencyOutcomes, RunAdmissionMessageInputModes } from "@opencrane/backend/agents/execution/runs";
import { AesGcmConversationPrivatePayloadCipher } from "@opencrane/backend/server/conversations/history";
import { ConversationComputerHistory } from "@opencrane/backend/server/conversations/computers";
import { KurrentConversationHistoryAdmissionReader } from "../messages/kurrent-conversation-history-admission-reader";
import { PrismaKurrentConversationPromptMessageRepository } from "../messages/db/prisma-kurrent-conversation-prompt-message-repository";
import type { ConversationComputerRunAdmissionCommand, ConversationComputerRunAdmissionPort } from "../computers/turns/conversation-computer-turn.types";
import { PersonalExecutionEvidenceAuthority, PrismaPersonalExecutionEvidenceRepository, ManagedExecutionEvidenceAuthority, PrismaManagedExecutionEvidenceRepository } from "@opencrane/backend/server/agents/agent-services";
import { AgentIdentityHistory } from "@opencrane/backend/server/iam/identity";
import { _CreateHumanMembershipEvidenceConfig, type HumanMembershipEvidenceConfig } from "@opencrane/backend/server/iam/membership";
import type { HistoryStore } from "@opencrane/backend/server/infra/history-store";
import { PrismaConversationPromptDocumentPreparationUnitOfWork } from "../messages/prisma-conversation-prompt-document-preparation-unit-of-work";
import type { ConversationPromptDocumentAuthorityFactory, ConversationPromptDocumentContentReader, ConversationPromptDocumentPreparation, ConversationPromptDocumentPreparationCommand } from "../messages/conversation-prompt-document.types";

import type { RunAdmissionConcurrencyPolicy } from "@opencrane/backend/agents/execution/runs";
import { _ReadConversationPrivatePayloadKeyring } from "@opencrane/backend/server/conversations/history";
import type { Logger } from "@opencrane/backend/observability";
import type { ConversationRunExecutionSubjectAuthorityFactory, ConversationRunHistoryAdmissionReaderFactory, ConversationRunInputCompilerRepositoryFactory, ConversationRunAuthorities } from "./run-admission-composition.types";

/**
 * Compose conversation run admission from the current personal or company identity authority.
 *
 * Called by: the OpenCrane process entrypoint before it creates the private computer router.
 * @see _CreateConversationRunAdmission for capacity and transaction sequencing.
 */
export function _CreateProductionConversationRunAdmission(prisma: ConstructorParameters<typeof PrismaRunAdmissionUnitOfWork>[0], history: HistoryStore, keyringPath: string, documentAuthorities: ConversationPromptDocumentAuthorityFactory, documentContent: ConversationPromptDocumentContentReader, policy: RunAdmissionConcurrencyPolicy, logger: Logger): ConversationComputerRunAdmissionPort
{
	const authorities = _CreateConversationRunAuthorities(history, _CreateHumanMembershipEvidenceConfig());
	const cipher = AesGcmConversationPrivatePayloadCipher.fromDocument(_ReadConversationPrivatePayloadKeyring(keyringPath));
	const documents = new PrismaConversationPromptDocumentPreparationUnitOfWork(prisma, history, documentAuthorities, documentContent);
	function _CreateMessages(command: ConversationComputerRunAdmissionCommand, prepared: ConversationPromptDocumentPreparation, transaction: Prisma.TransactionClient): VerifiedConversationPromptMessageRepository
	{
		const requester = _DocumentRequester(command);
		const source = new PrismaKurrentConversationPromptMessageRepository(transaction, history, cipher, command.computer.siloId, command.computer.conversationId, command.messageInput.historyRevision, prepared, documentAuthorities.create(transaction), requester);
		return new VerifiedConversationPromptMessageRepository(source);
	}
	const compilers: ConversationRunInputCompilerRepositoryFactory = {
		prepare: function _PrepareDocuments(command) { return documents.prepare(_DocumentCommand(command)); },
		create: function _CreateCompiler(command, prepared, transaction) { return new PrismaPromptCompilerRepository(transaction, _CreateMessages(command, prepared, transaction), command.computer.siloId); },
		compile: function _CompileIdempotent(command, prepared, snapshot)
		{
			const compiler = new PrismaPromptCompilerUnitOfWork(prisma, function _CreateIdempotentMessages(transaction) { return _CreateMessages(command, prepared, transaction); });
			return compiler.compile(snapshot, snapshot.attempt);
		},
	};
	return _CreateConversationRunAdmission(prisma, authorities.executionSubjects, authorities.histories, compilers, policy, logger);
}

/** Convert a server-resolved computer command into document preparation coordinates. */
function _DocumentCommand(command: ConversationComputerRunAdmissionCommand): ConversationPromptDocumentPreparationCommand
{
	return { siloId: command.computer.siloId, conversationId: command.computer.conversationId, historyRevision: command.messageInput.historyRevision,
		orderedMessageIds: command.messageInput.orderedMessageIds, requester: _DocumentRequester(command) };
}

/** Preserve the original authenticated participant for each source authority check. */
function _DocumentRequester(command: ConversationComputerRunAdmissionCommand)
{
	return { siloId: command.computer.siloId, principalId: command.requesterPrincipalId, subjectId: command.requesterSubjectId,
		externalIssuer: command.requesterIssuer, verifiedAuthenticationAt: command.requesterAuthenticatedAt };
}

/** Build transaction-bound identity evidence and exact Kurrent history authorities for admission. */
function _CreateConversationRunAuthorities(history: HistoryStore, membership: HumanMembershipEvidenceConfig): ConversationRunAuthorities
{
	const identityHistory = new AgentIdentityHistory(history);
	const computerHistory = new ConversationComputerHistory(history);
	const conversationHistory = new KurrentConversationHistoryAdmissionReader(history);
	return {
		executionSubjects: { create: function _CreateExecutionSubject(command: ConversationComputerRunAdmissionCommand)
		{
			const personal = new PersonalConversationExecutionSubjectAuthority({
				coordinates: command,
				identityHistory,
				computerHistory,
				executionEvidence: function _CreateExecutionEvidence(transaction)
				{
					const repository = new PrismaPersonalExecutionEvidenceRepository(transaction.prisma as Prisma.TransactionClient, membership);
					return new PersonalExecutionEvidenceAuthority(repository);
				},
			});
			const managed = new ManagedConversationExecutionSubjectAuthority({
				coordinates: command,
				identityHistory,
				computerHistory,
				executionEvidence: function _CreateManagedEvidence(transaction)
				{
					return new ManagedExecutionEvidenceAuthority(new PrismaManagedExecutionEvidenceRepository(transaction.prisma as Prisma.TransactionClient, membership));
				},
				resolvePrincipalId: async function _ResolveManagedPrincipal(transaction)
				{
					const current = await new PrismaManagedExecutionEvidenceRepository(transaction.prisma as Prisma.TransactionClient, membership).loadCurrent(command.computer.siloId, command.agent.agentServiceId);
					return current?.principalId ?? null;
				},
			});
			const selection: ExecutionSubjectAuthority = {
				load: function _LoadCurrentIdentity(command, run, transaction)
				{
					return new PrismaConversationExecutionSubjectAuthority(transaction.prisma as Prisma.TransactionClient, personal, managed).load(command, run, transaction);
				},
			};
			return selection;
		} },
		histories: { create: function _CreateConversationHistory() { return conversationHistory; } },
	};
}

/** Compose one process-wide admission queue around the canonical run and snapshot transaction owner. */
export function _CreateConversationRunAdmission(prisma: ConstructorParameters<typeof PrismaRunAdmissionUnitOfWork>[0], executionSubjects: ConversationRunExecutionSubjectAuthorityFactory, histories: ConversationRunHistoryAdmissionReaderFactory, compilers: ConversationRunInputCompilerRepositoryFactory, policy: RunAdmissionConcurrencyPolicy, logger: Logger): ConversationComputerRunAdmissionPort
{
	const concurrency = new RunAdmissionConcurrencyGate(policy);
	const persistence = new PrismaRunAdmissionUnitOfWork(prisma, undefined, logger);
	return {
		admit: async function _AdmitConversationRun(command: ConversationComputerRunAdmissionCommand)
		{
			let compiled;
			let prepared: ConversationPromptDocumentPreparation | undefined;
			const admission = {
				runId: command.runId,
				siloId: command.computer.siloId,
				agentServiceId: command.agent.agentServiceId,
				conversationId: command.computer.conversationId,
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
				const currentPreparation = await compilers.prepare(command);
				prepared = currentPreparation;
				const authorities = __CreatePrismaSessionAssemblyAuthorities(persistence, executionSubjects.create(command), histories.create(command));
				return await __AssembleRunInputSnapshot(admission, authorities, async function _CompileBeforeCommit(transaction, value)
				{
					compiled = await __CompileRunInput(value.snapshot, value.snapshot.attempt, compilers.create(command, currentPreparation, transaction.prisma as Prisma.TransactionClient));
				});
			});
			if (result.outcome === RunAdmissionConcurrencyOutcomes.Rejected)
				throw new Error("Conversation run admission capacity is exhausted");
			if (result.value.outcome === SessionAssemblyOutcomes.Denied)
			{
				logger.warn({ operation: "conversation.run.admission", reason: result.value.reason, runId: command.runId, siloId: command.computer.siloId, conversationId: command.computer.conversationId, agentServiceId: command.agent.agentServiceId }, "Conversation run admission was denied");
				throw new Error("Conversation run admission was denied");
			}
			if (command.agent.agentRevisionId !== result.value.snapshot.agentRevisionId)
				throw new Error("Conversation run admission selected another agent revision");
			if (prepared === undefined)
				throw new Error("Conversation run admission did not prepare prompt documents");
			const compiledInput = compiled ?? await compilers.compile(command, prepared, result.value.snapshot);
			return { compiledInput, authorityExpiresAt: __RunInputAuthorityExpiresAt(result.value.snapshot, compiledInput, result.value.currentExecutionSubject) };
		},
	};
}
