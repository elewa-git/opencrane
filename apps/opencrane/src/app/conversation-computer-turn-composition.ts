import { __AssertConversationComputerAnswerAuthority, PrismaConversationToolProposalUnitOfWork, PrismaConversationToolResultsUnitOfWork, PrismaConversationModelCustodyUnitOfWork } from "@opencrane/backend/server/conversations";
import { _CreateHumanMembershipEvidenceConfig } from "@opencrane/backend/server/iam/membership";
import { _CreateConversationToolDispatchDependencies } from "./mcp-runtime-composition";
import type * as k8s from "@kubernetes/client-node";
import type { PrismaClient } from "@prisma/client";
import { PrismaConversationRunLifecycleUnitOfWork } from "@opencrane/backend/agents/execution/runs";
import { AesGcmConversationPrivatePayloadCipher, ActiveConversationComputerTurnCandidateResolver, BoundConversationWriter, ConversationComputerHistory, ConversationComputerTurnAuthorityService, KeyedConversationComputerReviewCredentialDeriver, KurrentConversationComputerTurnStore, PrismaConversationComputerCredentialUnitOfWork, PrismaConversationComputerTurnUnitOfWork, _CreateConversationComputerTurnRouter } from "@opencrane/backend/server/conversations";
import type { ConversationComputerCredentialIssuer, ConversationComputerModelTransport, ConversationComputerProcessIdentity, ConversationComputerRealizer, ConversationComputerRunAdmissionPort, ConversationComputerTurnAuthority, ConversationToolProposalRuntimeAdmission, FrozenConversationComputerTurn } from "@opencrane/backend/server/conversations";
import { __RequestConversationModel, _IssueAttemptLiteLlmKey, _RevokeAttemptLiteLlmKey, _RevokeAttemptLiteLlmKeyByAlias } from "@opencrane/backend/server/gateways/model-routing";
import type { HistoryStore } from "@opencrane/backend/server/infra/history-store";
import { _CreateConversationComputerTokenReviewer } from "@opencrane/backend/server/infra/workload-identity";

import type { AgentSandboxReleaseProfileConfig } from "./config.types";
import { _ReadConversationPrivatePayloadKeyring } from "./conversation-history-composition";
import { _log } from "./log";
import { AgentSandboxConversationComputerRealizer, KubernetesConversationComputerProcessAuthenticator } from "./conversation-computer-agent-sandbox-realizer";

/** Dependencies shared by production Sandbox and workstation process realizations. */
interface _ConversationComputerTurnAuthorityCompositionOptions
{
	readonly credentials: ConversationComputerCredentialIssuer;
	readonly endpoint: string;
	readonly history: HistoryStore;
	readonly keyringPath: string;
	readonly maximumTurnCostUsdMicros: number;
	readonly model: ConversationComputerModelTransport;
	readonly prisma: PrismaClient;
	readonly realizer: ConversationComputerRealizer;
	readonly runAdmission: ConversationComputerRunAdmissionPort;
	readonly runtimeAdmission: ConversationToolProposalRuntimeAdmission;
	readonly siloId: string;
}

/** Compose the realization-neutral turn authority shared by production and Tier 2. */
export function _CreateConversationComputerTurnAuthority(options: _ConversationComputerTurnAuthorityCompositionOptions): ConversationComputerTurnAuthority
{
	const { credentials, endpoint, history, keyringPath, maximumTurnCostUsdMicros, model, prisma, realizer, runAdmission, runtimeAdmission, siloId } = options;
	const keyring = _ReadConversationPrivatePayloadKeyring(keyringPath);
	const cipher = AesGcmConversationPrivatePayloadCipher.fromDocument(keyring);
	const unitOfWork = new PrismaConversationComputerTurnUnitOfWork(prisma, history, cipher, maximumTurnCostUsdMicros, runAdmission);
	const candidates = new ActiveConversationComputerTurnCandidateResolver(siloId, unitOfWork, new ConversationComputerHistory(history), realizer, unitOfWork);
	const turnStore = new KurrentConversationComputerTurnStore(history);
	const toolDependencies = _CreateConversationToolDispatchDependencies(history, _CreateHumanMembershipEvidenceConfig());
	const toolProposals = new PrismaConversationToolProposalUnitOfWork(prisma, toolDependencies, runtimeAdmission);
	const toolResults = new PrismaConversationToolResultsUnitOfWork(prisma, siloId, turnStore, candidates, toolDependencies);
	const writers = { create: function _CreateWriter(turn: FrozenConversationComputerTurn, process: ConversationComputerProcessIdentity)
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
		} }, { assertMayAppend: async function _RecheckLeaseAtAppend() { await __AssertConversationComputerAnswerAuthority(turn, process, { candidates, toolResults }); } });
	} };
	const modelCustody = new PrismaConversationModelCustodyUnitOfWork(prisma, cipher);
	return new ConversationComputerTurnAuthorityService({ logger: _log, model, modelCustody, toolResults, toolProposals, siloId, candidates, credentials, endpoint, outputPayloads: unitOfWork, reviewCredentials: KeyedConversationComputerReviewCredentialDeriver.fromKeyring(keyring), runLifecycle: new PrismaConversationRunLifecycleUnitOfWork(prisma), store: turnStore, writers });
}

/** Compose the private Pod-authenticated turn transport from concrete product and infrastructure adapters. */
export function _CreateConversationComputerTurnComposition(prisma: PrismaClient, history: HistoryStore, authApi: k8s.AuthenticationV1Api, coreApi: k8s.CoreV1Api, customApi: k8s.CustomObjectsApi, siloId: string, profile: AgentSandboxReleaseProfileConfig, keyringPath: string, runAdmission: ConversationComputerRunAdmissionPort, runtimeAdmission: ConversationToolProposalRuntimeAdmission)
{
	const realizer = new AgentSandboxConversationComputerRealizer(customApi, coreApi, profile);
	const keyring = _ReadConversationPrivatePayloadKeyring(keyringPath);
	const cipher = AesGcmConversationPrivatePayloadCipher.fromDocument(keyring);
	const credentials = new PrismaConversationComputerCredentialUnitOfWork(prisma, cipher, { issue: _IssueAttemptLiteLlmKey, revoke: _RevokeAttemptLiteLlmKey, revokeByAlias: _RevokeAttemptLiteLlmKeyByAlias }, siloId);
	const authority = _CreateConversationComputerTurnAuthority({ credentials, endpoint: process.env.LITELLM_ENDPOINT ?? "", history, keyringPath, maximumTurnCostUsdMicros: profile.maximumTurnCostUsdMicros, model: { request: __RequestConversationModel }, prisma, realizer, runAdmission, runtimeAdmission, siloId });
	const reviewer = _CreateConversationComputerTokenReviewer(authApi, profile.namespace, profile.serviceAccountName);
	return _CreateConversationComputerTurnRouter({ logger: _log, authenticator: new KubernetesConversationComputerProcessAuthenticator(reviewer), authority });
}
