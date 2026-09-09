import type * as k8s from "@kubernetes/client-node";
import { PrismaConversationRunLifecycleUnitOfWork } from "@opencrane/backend/agents/execution/runs";
import { PrismaConversationToolProposalUnitOfWork, PrismaConversationToolResultsUnitOfWork, PrismaConversationModelCustodyUnitOfWork, ConversationComputerTurnWriterFactory, ActiveConversationComputerTurnCandidateResolver, ConversationComputerTurnAuthorityService, KeyedConversationComputerReviewCredentialDeriver, KurrentConversationComputerTurnStore, PrismaConversationComputerCredentialUnitOfWork, PrismaConversationComputerTurnUnitOfWork, _CreateConversationComputerTurnRouter, type ConversationComputerRunAdmissionPort, type ConversationToolProposalRuntimeAdmission } from "@opencrane/backend/server/conversations";
import { ConversationComputerHistory } from "@opencrane/backend/server/conversations/computers";
import { AesGcmConversationPrivatePayloadCipher, _ReadConversationPrivatePayloadKeyring } from "@opencrane/backend/server/conversations/history";
import { __RequestConversationModel, _IssueAttemptLiteLlmKey, _RevokeAttemptLiteLlmKey, _RevokeAttemptLiteLlmKeyByAlias } from "@opencrane/backend/server/gateways/model-routing";
import { _CreateHumanMembershipEvidenceConfig } from "@opencrane/backend/server/iam/membership";
import { AgentSandboxPodBindingAdapter } from "@opencrane/backend/server/infra/agent-sandbox";
import { type HistoryStore } from "@opencrane/backend/server/infra/history-store";
import { _CreateConversationComputerTokenReviewer } from "@opencrane/backend/server/infra/workload-identity";
import { type PrismaClient } from "@prisma/client";
import { type AgentSandboxReleaseProfileConfig } from "../configuration/config.types";
import { _log } from "../process/log";
import { _CreateConversationToolDispatchDependencies } from "../workflows/mcp-runtime-composition";

/** Compose the private Pod-authenticated turn transport from concrete product and infrastructure adapters. */
export function _CreateConversationComputerTurnComposition(prisma: PrismaClient, history: HistoryStore, authApi: k8s.AuthenticationV1Api, coreApi: k8s.CoreV1Api, customApi: k8s.CustomObjectsApi, siloId: string, profile: AgentSandboxReleaseProfileConfig, keyringPath: string, runAdmission: ConversationComputerRunAdmissionPort, runtimeAdmission: ConversationToolProposalRuntimeAdmission)
{
	const keyring = _ReadConversationPrivatePayloadKeyring(keyringPath);
	const cipher = AesGcmConversationPrivatePayloadCipher.fromDocument(keyring);
	const unitOfWork = new PrismaConversationComputerTurnUnitOfWork(prisma, history, cipher, profile.maximumTurnCostUsdMicros, runAdmission);
	const candidates = new ActiveConversationComputerTurnCandidateResolver(siloId, unitOfWork, new ConversationComputerHistory(history), new AgentSandboxPodBindingAdapter(coreApi, customApi), unitOfWork);
	const credentials = new PrismaConversationComputerCredentialUnitOfWork(prisma, cipher, { issue: _IssueAttemptLiteLlmKey, revoke: _RevokeAttemptLiteLlmKey, revokeByAlias: _RevokeAttemptLiteLlmKeyByAlias }, siloId);
	const turnStore = new KurrentConversationComputerTurnStore(history);
	const toolDependencies = _CreateConversationToolDispatchDependencies(history, _CreateHumanMembershipEvidenceConfig());
	const toolProposals = new PrismaConversationToolProposalUnitOfWork(prisma, toolDependencies, runtimeAdmission);
	const toolResults = new PrismaConversationToolResultsUnitOfWork(prisma, siloId, turnStore, candidates, toolDependencies);
	const writers = new ConversationComputerTurnWriterFactory(history, turnStore, candidates, toolResults);
	const modelCustody = new PrismaConversationModelCustodyUnitOfWork(prisma, cipher);
	const authority = new ConversationComputerTurnAuthorityService({ logger: _log, model: { request: __RequestConversationModel }, modelCustody, toolResults, toolProposals, siloId, candidates, credentials, endpoint: process.env.LITELLM_ENDPOINT ?? "", outputPayloads: unitOfWork, reviewCredentials: KeyedConversationComputerReviewCredentialDeriver.fromKeyring(keyring), runLifecycle: new PrismaConversationRunLifecycleUnitOfWork(prisma), store: turnStore, writers });
	return _CreateConversationComputerTurnRouter({ logger: _log, tokenReviewer: _CreateConversationComputerTokenReviewer(authApi, profile.namespace, profile.serviceAccountName), authority });
}
