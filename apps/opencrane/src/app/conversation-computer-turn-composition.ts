import type * as k8s from "@kubernetes/client-node";
import type { PrismaClient } from "@prisma/client";
import { PrismaConversationRunLifecycleUnitOfWork } from "@opencrane/backend/agents/execution/runs";
import { AesGcmConversationPrivatePayloadCipher, ActiveConversationComputerTurnCandidateResolver, BoundConversationWriter, ConversationComputerHistory, ConversationComputerTurnAuthorityService, KeyedConversationComputerReviewCredentialDeriver, KurrentConversationComputerTurnStore, PrismaConversationComputerCredentialUnitOfWork, PrismaConversationComputerTurnUnitOfWork, _CreateConversationComputerTurnRouter } from "@opencrane/backend/server/conversations";
import type { ConversationComputerRunAdmissionPort, FrozenConversationComputerTurn } from "@opencrane/backend/server/conversations";
import { _IssueAttemptLiteLlmKey, _RevokeAttemptLiteLlmKey, _RevokeAttemptLiteLlmKeyByAlias } from "@opencrane/backend/server/gateways/model-routing";
import { AgentSandboxPodBindingAdapter } from "@opencrane/backend/server/infra/agent-sandbox";
import type { HistoryStore } from "@opencrane/backend/server/infra/history-store";
import { _CreateConversationComputerTokenReviewer, type RuntimeWorkloadIdentity } from "@opencrane/backend/server/infra/workload-identity";

import type { AgentSandboxReleaseProfileConfig } from "./config.types";
import { _ReadConversationPrivatePayloadKeyring } from "./conversation-history-composition";

/** Compose the private Pod-authenticated turn transport from concrete product and infrastructure adapters. */
export function _CreateConversationComputerTurnComposition(prisma: PrismaClient, history: HistoryStore, authApi: k8s.AuthenticationV1Api, coreApi: k8s.CoreV1Api, customApi: k8s.CustomObjectsApi, siloId: string, profile: AgentSandboxReleaseProfileConfig, keyringPath: string, runAdmission: ConversationComputerRunAdmissionPort)
{
	const keyring = _ReadConversationPrivatePayloadKeyring(keyringPath);
	const cipher = AesGcmConversationPrivatePayloadCipher.fromDocument(keyring);
	const unitOfWork = new PrismaConversationComputerTurnUnitOfWork(prisma, history, cipher, profile.maximumTurnCostUsdMicros, runAdmission);
	const candidates = new ActiveConversationComputerTurnCandidateResolver(siloId, unitOfWork, new ConversationComputerHistory(history), new AgentSandboxPodBindingAdapter(coreApi, customApi), unitOfWork);
	const credentials = new PrismaConversationComputerCredentialUnitOfWork(prisma, cipher, { issue: _IssueAttemptLiteLlmKey, revoke: _RevokeAttemptLiteLlmKey, revokeByAlias: _RevokeAttemptLiteLlmKeyByAlias }, siloId);
	const turnStore = new KurrentConversationComputerTurnStore(history);
	const writers = { create: function _CreateWriter(turn: FrozenConversationComputerTurn, workload: RuntimeWorkloadIdentity)
	{
		return new BoundConversationWriter(history, turn.binding, { now: function _Now() { return new Date(); } }, { assertMayAppend: async function _RequirePendingTurn()
		{
			const current = await turnStore.load(turn.bootstrapId);
			if (current === null || current.outputSourceCommandId !== turn.outputSourceCommandId)
				throw new Error("Conversation computer turn has conflicting output");
		} }, { assertMayUseVisibility: async function _RequireConversationAudience(_binding, visibility)
		{
			if (visibility.audience !== "conversation")
				throw new Error("Conversation computer output requires conversation visibility");
		} }, { assertMayAppend: async function _RecheckLeaseAtAppend() { await candidates.assertCurrent(turn, workload); } });
	} };
	const authority = new ConversationComputerTurnAuthorityService({ siloId, candidates, credentials, endpoint: process.env.LITELLM_ENDPOINT ?? "", outputPayloads: unitOfWork, reviewCredentials: KeyedConversationComputerReviewCredentialDeriver.fromKeyring(keyring), runLifecycle: new PrismaConversationRunLifecycleUnitOfWork(prisma), store: turnStore, writers });
	return _CreateConversationComputerTurnRouter({ tokenReviewer: _CreateConversationComputerTokenReviewer(authApi, profile.namespace, profile.serviceAccountName), authority });
}
