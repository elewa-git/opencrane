import type * as k8s from "@kubernetes/client-node";
import type { PrismaClient } from "@prisma/client";
import { AesGcmConversationPrivatePayloadCipher, ActiveConversationComputerTurnCandidateResolver, BoundConversationWriter, ConversationComputerHistory, ConversationComputerTurnAuthorityService, KurrentConversationComputerTurnStore, PrismaConversationComputerCredentialUnitOfWork, PrismaConversationComputerTurnUnitOfWork, _CreateConversationComputerTurnRouter } from "@opencrane/backend/server/conversations";
import type { FrozenConversationComputerTurn } from "@opencrane/backend/server/conversations";
import { _IssueAttemptLiteLlmKey, _RevokeAttemptLiteLlmKey } from "@opencrane/backend/server/gateways/model-routing";
import { AgentSandboxPodBindingAdapter } from "@opencrane/backend/server/infra/agent-sandbox";
import type { HistoryStore } from "@opencrane/backend/server/infra/history-store";
import { _CreateConversationComputerTokenReviewer, type RuntimeWorkloadIdentity } from "@opencrane/backend/server/infra/workload-identity";

import type { AgentSandboxReleaseProfileConfig } from "./config.types";
import { _ReadConversationPrivatePayloadKeyring } from "./conversation-history-composition";

/** Compose the private Pod-authenticated turn transport from concrete product and infrastructure adapters. */
export function _CreateConversationComputerTurnComposition(prisma: PrismaClient, history: HistoryStore, authApi: k8s.AuthenticationV1Api, coreApi: k8s.CoreV1Api, customApi: k8s.CustomObjectsApi, profile: AgentSandboxReleaseProfileConfig, keyringPath: string)
{
	const cipher = AesGcmConversationPrivatePayloadCipher.fromDocument(_ReadConversationPrivatePayloadKeyring(keyringPath));
	const unitOfWork = new PrismaConversationComputerTurnUnitOfWork(prisma, history, cipher, profile.maximumTurnCostUsdMicros);
	const candidates = new ActiveConversationComputerTurnCandidateResolver(unitOfWork, new ConversationComputerHistory(history), new AgentSandboxPodBindingAdapter(coreApi, customApi), unitOfWork);
	const credentials = new PrismaConversationComputerCredentialUnitOfWork(prisma, cipher, { issue: _IssueAttemptLiteLlmKey, revoke: _RevokeAttemptLiteLlmKey }, profile.namespace);
	const turnStore = new KurrentConversationComputerTurnStore(history);
	const writers = { create: function _CreateWriter(turn: FrozenConversationComputerTurn, workload: RuntimeWorkloadIdentity)
	{
		return new BoundConversationWriter(history, turn.binding, { now: function _Now() { return new Date(); } }, { assertMayAppend: async function _RequirePendingTurn()
		{
			const current = await turnStore.load(turn.bootstrapId);
			if (current?.outputSourceCommandId !== null)
				throw new Error("Conversation computer turn already has output");
		} }, { assertMayUseVisibility: async function _RequireConversationAudience(_binding, visibility)
		{
			if (visibility.audience !== "conversation")
				throw new Error("Conversation computer output requires conversation visibility");
		} }, { assertMayAppend: async function _RecheckLeaseAtAppend() { await candidates.assertCurrent(turn, workload); } });
	} };
	const authority = new ConversationComputerTurnAuthorityService({ candidates, credentials, endpoint: process.env.LITELLM_ENDPOINT ?? "", outputPayloads: unitOfWork, store: turnStore, writers });
	return _CreateConversationComputerTurnRouter({ tokenReviewer: _CreateConversationComputerTokenReviewer(authApi, profile.namespace, profile.serviceAccountName), authority });
}
