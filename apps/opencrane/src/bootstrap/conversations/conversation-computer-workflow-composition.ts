import type * as k8s from "@kubernetes/client-node";
import { PrismaElicitationRepository } from "@opencrane/backend/agents/execution/elicitation";
import { PrismaConversationRunLifecycleUnitOfWork } from "@opencrane/backend/agents/execution/runs";
import { _ConversationComputerStopAuthority, _RegisterConversationComputerStopWorkflow, PrismaConversationComputerStopAdmissionUnitOfWork, PrismaConversationComputerStopLifecycleUnitOfWork, PrismaConversationComputerStopTargetUnitOfWork, KurrentConversationComputerStopActiveTurnReader, KurrentConversationComputerStopPublisher, PrismaConversationToolProposalUnitOfWork, PrismaConversationToolResultsUnitOfWork, PrismaConversationModelCustodyUnitOfWork, ConversationComputerTurnWriterFactory, ActiveConversationComputerTurnCandidateResolver, ConversationComputerTurnAuthorityService, KeyedConversationComputerReviewCredentialDeriver, CurrentConversationToolResultNotificationEvidenceReader, KurrentConversationToolResultNotificationPublisher, KurrentConversationApprovalNotificationPublisher, KurrentConversationComputerTurnStore, PrismaConversationApprovalNotificationUnitOfWork, PrismaConversationComputerCredentialUnitOfWork, PrismaConversationComputerTurnUnitOfWork, PrismaConversationComputerTurnWorkflowReceiptBinder, PrismaConversationComputerTurnWorkflowEventRepository, _CreateConversationComputerReviewCredentialRouter, _RegisterConversationComputerTurnWorkflow, type ConversationComputerRunAdmissionPort, type ConversationToolProposalRuntimeAdmission } from "@opencrane/backend/server/conversations";
import { ConversationComputerHistory } from "@opencrane/backend/server/conversations/computers";
import { AesGcmConversationPrivatePayloadCipher, ConversationHistoryAuthority, ConversationHistoryReader, _ReadConversationPrivatePayloadKeyring } from "@opencrane/backend/server/conversations/history";
import { __RequestConversationModel, _IssueAttemptLiteLlmKey, _RevokeAttemptLiteLlmKey, _RevokeAttemptLiteLlmKeyByAlias } from "@opencrane/backend/server/gateways/model-routing";
import { _CreateHumanMembershipEvidenceConfig } from "@opencrane/backend/server/iam/membership";
import { AgentSandboxPodBindingAdapter } from "@opencrane/backend/server/infra/agent-sandbox";
import { type HistoryStore } from "@opencrane/backend/server/infra/history-store";
import { _CreateConversationComputerTokenReviewer } from "@opencrane/backend/server/infra/workload-identity";
import { Prisma, type PrismaClient } from "@prisma/client";
import { type AgentSandboxReleaseProfileConfig } from "../configuration/config.types";
import { _log } from "../process/log";
import { _CreateConversationToolDispatchDependencies } from "../workflows/mcp-runtime-composition";
import type { IWorkflowEngine } from "@opencrane/backend/server/infra/workflows/contract";

/** Compose the server-owned turn workflow and its lease-fenced review credential route. */
export function _CreateConversationComputerWorkflowComposition(prisma: PrismaClient, history: HistoryStore, authApi: k8s.AuthenticationV1Api, coreApi: k8s.CoreV1Api, customApi: k8s.CustomObjectsApi, siloId: string, profile: AgentSandboxReleaseProfileConfig, keyringPath: string, runAdmission: ConversationComputerRunAdmissionPort, runtimeAdmission: ConversationToolProposalRuntimeAdmission, workflows: IWorkflowEngine)
{
	const keyring = _ReadConversationPrivatePayloadKeyring(keyringPath);
	const cipher = AesGcmConversationPrivatePayloadCipher.fromDocument(keyring);
	const unitOfWork = new PrismaConversationComputerTurnUnitOfWork(prisma, history, cipher, profile.maximumTurnCostUsdMicros, runAdmission);
	const candidates = new ActiveConversationComputerTurnCandidateResolver(siloId, unitOfWork, new ConversationComputerHistory(history), new AgentSandboxPodBindingAdapter(coreApi, customApi), unitOfWork, { namespace: profile.namespace, serviceAccountName: profile.serviceAccountName });
	const credentials = new PrismaConversationComputerCredentialUnitOfWork(prisma, cipher, { issue: _IssueAttemptLiteLlmKey, revoke: _RevokeAttemptLiteLlmKey, revokeByAlias: _RevokeAttemptLiteLlmKeyByAlias }, siloId);
	const turnStore = new KurrentConversationComputerTurnStore(history);
	const toolDependencies = _CreateConversationToolDispatchDependencies(history, _CreateHumanMembershipEvidenceConfig());
	async function _ExpireApproval(transaction: unknown, command: { readonly runId: string; readonly attempt: number; readonly now: Date }): Promise<void>
	{
		const events = new PrismaConversationComputerTurnWorkflowEventRepository(transaction as Prisma.TransactionClient, workflows);
		const elicitations = new PrismaElicitationRepository(transaction as Prisma.TransactionClient, events);
		await elicitations.expireDue(command);
	}
	const toolProposals = new PrismaConversationToolProposalUnitOfWork(prisma, toolDependencies, runtimeAdmission, _ExpireApproval);
	const toolResults = new PrismaConversationToolResultsUnitOfWork(prisma, siloId, turnStore, candidates, toolDependencies);
	const writers = new ConversationComputerTurnWriterFactory(history, turnStore, candidates, toolResults);
	const modelCustody = new PrismaConversationModelCustodyUnitOfWork(prisma, cipher);
	const historyAuthority = new ConversationHistoryAuthority(history);
	const historyReader = new ConversationHistoryReader(history);
	const toolResultEvidence = new CurrentConversationToolResultNotificationEvidenceReader(turnStore, candidates, toolResults);
	const toolResultNotifications = new KurrentConversationToolResultNotificationPublisher(toolResultEvidence, historyAuthority, historyReader, history);
	const authority = new ConversationComputerTurnAuthorityService({ logger: _log, model: { request: __RequestConversationModel }, modelCustody, toolResults, toolResultNotifications, toolProposals, siloId, candidates, credentials, endpoint: process.env.LITELLM_ENDPOINT ?? "", outputPayloads: unitOfWork, reviewCredentials: KeyedConversationComputerReviewCredentialDeriver.fromKeyring(keyring), runLifecycle: new PrismaConversationRunLifecycleUnitOfWork(prisma), store: turnStore, writers });
	const approvalNotifications = new KurrentConversationApprovalNotificationPublisher(new PrismaConversationApprovalNotificationUnitOfWork(prisma), historyAuthority, historyReader, history);
	_RegisterConversationComputerTurnWorkflow(workflows, { approvalNotifications, authority, receipts: new PrismaConversationComputerTurnWorkflowReceiptBinder(prisma), siloId });
	const stopAdmissions = new PrismaConversationComputerStopAdmissionUnitOfWork(prisma, workflows);
	const stopTargets = new PrismaConversationComputerStopTargetUnitOfWork(prisma, new KurrentConversationComputerStopActiveTurnReader(history));
	const stopPublisher = new KurrentConversationComputerStopPublisher(history);
	const stopAuthority = new _ConversationComputerStopAuthority(stopAdmissions, stopTargets, stopPublisher);
	const stopLifecycle = new PrismaConversationComputerStopLifecycleUnitOfWork(prisma);
	_RegisterConversationComputerStopWorkflow(workflows, { admissions: stopAdmissions, publisher: stopPublisher, lifecycle: stopLifecycle, credentials });
	const reviewCredentialRouter = _CreateConversationComputerReviewCredentialRouter({ logger: _log, tokenReviewer: _CreateConversationComputerTokenReviewer(authApi, profile.namespace, profile.serviceAccountName), authority });
	return { reviewCredentialRouter, stopAuthority };
}
