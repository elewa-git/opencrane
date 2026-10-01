import type { Prisma } from "@prisma/client";
import { PrismaElicitationRepository } from "@opencrane/backend/agents/execution/elicitation";
import { PrismaConversationRunLifecycleUnitOfWork } from "@opencrane/backend/agents/execution/runs";
import { CurrentConversationToolRequestedNotificationEvidenceReader, KurrentConversationToolRequestedNotificationPublisher, _ConversationComputerStopAuthority, _RegisterConversationComputerStopWorkflow, PrismaConversationComputerStopAdmissionUnitOfWork, PrismaConversationComputerStopLifecycleUnitOfWork, PrismaConversationComputerStopTargetUnitOfWork, KurrentConversationComputerStopActiveTurnReader, KurrentConversationComputerStopPublisher, PrismaConversationToolProposalUnitOfWork, PrismaConversationToolResultsUnitOfWork, PrismaConversationModelCustodyUnitOfWork, ConversationComputerTurnWriterFactory, ActiveConversationComputerTurnCandidateResolver, ConversationComputerTurnAuthorityService, KeyedConversationComputerReviewCredentialDeriver, CurrentConversationToolResultNotificationEvidenceReader, KurrentConversationToolResultNotificationPublisher, KurrentConversationApprovalNotificationPublisher, KurrentConversationComputerTurnStore, PrismaConversationApprovalNotificationUnitOfWork, PrismaConversationComputerTurnUnitOfWork, PrismaConversationComputerTurnWorkflowReceiptBinder, PrismaConversationComputerTurnWorkflowEventRepository, _CreateConversationComputerReviewCredentialRouter, _RegisterConversationComputerTurnWorkflow } from "@opencrane/backend/server/conversations";
import { ConversationComputerHistory } from "@opencrane/backend/server/conversations/computers";
import { AesGcmConversationPrivatePayloadCipher, ConversationHistoryAuthority, ConversationHistoryReader, _ReadConversationPrivatePayloadKeyring } from "@opencrane/backend/server/conversations/history";
import { _CreateHumanMembershipEvidenceConfig } from "@opencrane/backend/server/iam/membership";
import { _log } from "../process/log";
import { _CreateConversationToolDispatchDependencies } from "../workflows/mcp-runtime-composition";
import type { ConversationExecutionContext } from "./conversation-computer-workflow-composition.types";

/**
 * Registers the conversation turn and stop workflows with their shared services.
 * Returns the credential router for the internal app and the stop authority for the activation worker.
 */
export function _CreateConversationComputerWorkflowComposition(executionContext: ConversationExecutionContext)
{
	const { prisma, history, siloId, profile, keyringPath, runAdmission, runtimeAdmission, toolDispatch, workflows, generatedFiles, generatedOutput, realizer, processes, authenticator, credentials, model, modelEndpoint } = executionContext;
	// Turn payloads, credentials and model custody share the cipher loaded from this keyring.
	const keyring = _ReadConversationPrivatePayloadKeyring(keyringPath);
	const cipher = AesGcmConversationPrivatePayloadCipher.fromDocument(keyring);
	const unitOfWork = new PrismaConversationComputerTurnUnitOfWork(prisma, history, cipher, profile.maximumTurnCostUsdMicros, runAdmission);
	const candidates = new ActiveConversationComputerTurnCandidateResolver(siloId, unitOfWork, new ConversationComputerHistory(history), realizer, processes, unitOfWork);
	const turnStore = new KurrentConversationComputerTurnStore(history);
	const toolDependencies = _CreateConversationToolDispatchDependencies(history, _CreateHumanMembershipEvidenceConfig());
	/** Expires approvals and records workflow wake-ups in the proposal caller's transaction so they commit together. */
	async function _ExpireApproval(transaction: unknown, command: { readonly runId: string; readonly attempt: number; readonly now: Date }): Promise<void>
	{
		const events = new PrismaConversationComputerTurnWorkflowEventRepository(transaction as Prisma.TransactionClient, workflows);
		const elicitations = new PrismaElicitationRepository(transaction as Prisma.TransactionClient, events);
		await elicitations.expireDue(command);
	}
	const toolProposals = new PrismaConversationToolProposalUnitOfWork(prisma, toolDependencies, runtimeAdmission, _ExpireApproval);
	// Writers and notification readers reuse these services to check the same saved turn and current candidate.
	const toolResults = new PrismaConversationToolResultsUnitOfWork(prisma, siloId, turnStore, candidates, toolDependencies, generatedFiles);
	const writers = new ConversationComputerTurnWriterFactory(history, turnStore, candidates, toolResults);
	const modelCustody = new PrismaConversationModelCustodyUnitOfWork(prisma, cipher);
	const historyAuthority = new ConversationHistoryAuthority(history);
	const historyReader = new ConversationHistoryReader(history);
	// Each tool notification publisher reads current evidence before adding a conversation history entry.
	const toolResultEvidence = new CurrentConversationToolResultNotificationEvidenceReader(turnStore, candidates, toolResults);
	const toolResultNotifications = new KurrentConversationToolResultNotificationPublisher(toolResultEvidence, historyAuthority, historyReader, history);
	const requestedEvidence = new CurrentConversationToolRequestedNotificationEvidenceReader(prisma, turnStore, candidates);
	const toolRequestedNotifications = new KurrentConversationToolRequestedNotificationPublisher(requestedEvidence, historyAuthority, historyReader, history);
	const authority = new ConversationComputerTurnAuthorityService({ logger: _log, model, modelCustody, toolResults, toolResultNotifications, toolRequestedNotifications, toolProposals, siloId, candidates, credentials, endpoint: modelEndpoint, outputPayloads: unitOfWork, generatedFiles: generatedOutput, reviewCredentials: KeyedConversationComputerReviewCredentialDeriver.fromKeyring(keyring), runLifecycle: new PrismaConversationRunLifecycleUnitOfWork(prisma), store: turnStore, writers });
	const approvalNotifications = new KurrentConversationApprovalNotificationPublisher(new PrismaConversationApprovalNotificationUnitOfWork(prisma), historyAuthority, historyReader, history);
	// Registration installs handlers; the workflow engine runs them when work is submitted.
	_RegisterConversationComputerTurnWorkflow(workflows, { approvalNotifications, authority, toolDispatch, receipts: new PrismaConversationComputerTurnWorkflowReceiptBinder(prisma), siloId });
	const stopAdmissions = new PrismaConversationComputerStopAdmissionUnitOfWork(prisma, workflows);
	const stopTargets = new PrismaConversationComputerStopTargetUnitOfWork(prisma, new KurrentConversationComputerStopActiveTurnReader(history));
	const stopPublisher = new KurrentConversationComputerStopPublisher(history);
	const stopAuthority = new _ConversationComputerStopAuthority(stopAdmissions, stopTargets, stopPublisher);
	const stopLifecycle = new PrismaConversationComputerStopLifecycleUnitOfWork(prisma);
	// Stop cleanup uses the same credential service that issues credentials for turns.
	_RegisterConversationComputerStopWorkflow(workflows, { admissions: stopAdmissions, publisher: stopPublisher, lifecycle: stopLifecycle, credentials });
	const reviewCredentialRouter = _CreateConversationComputerReviewCredentialRouter({ logger: _log, authenticator, authority });
	return { reviewCredentialRouter, stopAuthority };
}
