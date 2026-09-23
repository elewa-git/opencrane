import type * as k8s from "@kubernetes/client-node";
import type { PrismaClient } from "@prisma/client";

import type { ConversationEntryVisibility } from "@opencrane/contracts";
import { PrismaConversationRunLifecycleUnitOfWork } from "@opencrane/backend/agents/execution/runs";
import { AesGcmConversationPrivatePayloadCipher, ActiveConversationComputerTurnCandidateResolver, BoundConversationWriter, ConversationComputerHistory, ConversationComputerTurnAuthorityService, KeyedConversationComputerReviewCredentialDeriver, KurrentConversationComputerTurnStore, PrismaConversationComputerCredentialUnitOfWork, PrismaConversationComputerTurnUnitOfWork, PrismaConversationModelCustodyUnitOfWork, PrismaConversationToolProposalUnitOfWork, PrismaConversationToolResultsUnitOfWork, __AssertConversationComputerAnswerAuthority, _CreateConversationComputerTurnRouter } from "@opencrane/backend/server/conversations";
import type { BoundConversationWriterBinding, ConversationComputerProcessIdentity, ConversationComputerRunAdmissionPort, ConversationComputerTurnAuthority, ConversationToolProposalRuntimeAdmission, FrozenConversationComputerTurn } from "@opencrane/backend/server/conversations";
import { __RequestConversationModel, _IssueAttemptLiteLlmKey, _RevokeAttemptLiteLlmKey, _RevokeAttemptLiteLlmKeyByAlias } from "@opencrane/backend/server/gateways/model-routing";
import { _CreateHumanMembershipEvidenceConfig } from "@opencrane/backend/server/iam/membership";
import type { HistoryStore } from "@opencrane/backend/server/infra/history-store";
import { _CreateConversationComputerTokenReviewer } from "@opencrane/backend/server/infra/workload-identity";

import type { AgentSandboxReleaseProfileConfig } from "./config.types";
import { AgentSandboxConversationComputerRealizer, KubernetesConversationComputerProcessAuthenticator } from "./conversation-computer-agent-sandbox-realizer";
import type { ConversationComputerTurnAuthorityCompositionOptions } from "./conversation-computer-turn-composition.types";
import { _ReadConversationPrivatePayloadKeyring } from "./conversation-history-composition";
import { _log } from "./log";
import { _CreateConversationToolDispatchDependencies } from "./mcp-runtime-composition";

/** Compose the realization-neutral turn authority shared by production and Tier 2. */
export function _CreateConversationComputerTurnAuthority(options: ConversationComputerTurnAuthorityCompositionOptions): ConversationComputerTurnAuthority
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

	/** Build a writer whose policies remain bound to the selected turn and process. */
	function _CreateWriter(turn: FrozenConversationComputerTurn, process: ConversationComputerProcessIdentity): BoundConversationWriter
	{
		/** Stamp a new entry with the current server time. */
		function _Now(): Date { return new Date(); }

		/** Refuse output after another source command has taken ownership of the turn. */
		async function _RequirePendingTurn(): Promise<void>
		{
			const current = await turnStore.load(turn.bootstrapId);

			if (current === null || current.outputSourceCommandId !== turn.outputSourceCommandId)
				throw new Error("Conversation computer turn has conflicting output");
		}

		/** Restrict this writer to the conversation audience supported by the turn route. */
		async function _RequireConversationAudience(_binding: BoundConversationWriterBinding, visibility: ConversationEntryVisibility): Promise<void>
		{
			if (visibility.audience !== "conversation")
				throw new Error("Conversation computer output requires conversation visibility");
		}

		/** Recheck the active lease immediately before the writer appends output. */
		async function _RecheckLeaseAtAppend(): Promise<void>
		{
			await __AssertConversationComputerAnswerAuthority(turn, process, {
				candidates,
				toolResults,
			});
		}

		return new BoundConversationWriter(
			history,
			turn.binding,
			{ now: _Now },
			{ assertMayAppend: _RequirePendingTurn },
			{ assertMayUseVisibility: _RequireConversationAudience },
			{ assertMayAppend: _RecheckLeaseAtAppend },
		);
	}

	const writers = { create: _CreateWriter };
	const modelCustody = new PrismaConversationModelCustodyUnitOfWork(prisma, cipher);

	return new ConversationComputerTurnAuthorityService({
		logger: _log,
		model,
		modelCustody,
		toolResults,
		toolProposals,
		siloId,
		candidates,
		credentials,
		endpoint,
		outputPayloads: unitOfWork,
		reviewCredentials: KeyedConversationComputerReviewCredentialDeriver.fromKeyring(keyring),
		runLifecycle: new PrismaConversationRunLifecycleUnitOfWork(prisma),
		store: turnStore,
		writers,
	});
}

/** Compose the private Pod-authenticated turn transport from concrete product and infrastructure adapters. */
export function _CreateConversationComputerTurnComposition(prisma: PrismaClient, history: HistoryStore, authApi: k8s.AuthenticationV1Api, coreApi: k8s.CoreV1Api, customApi: k8s.CustomObjectsApi, siloId: string, profile: AgentSandboxReleaseProfileConfig, keyringPath: string, runAdmission: ConversationComputerRunAdmissionPort, runtimeAdmission: ConversationToolProposalRuntimeAdmission)
{
	const realizer = new AgentSandboxConversationComputerRealizer(customApi, coreApi, profile);
	const keyring = _ReadConversationPrivatePayloadKeyring(keyringPath);
	const cipher = AesGcmConversationPrivatePayloadCipher.fromDocument(keyring);
	const credentials = new PrismaConversationComputerCredentialUnitOfWork(prisma, cipher, {
		issue: _IssueAttemptLiteLlmKey,
		revoke: _RevokeAttemptLiteLlmKey,
		revokeByAlias: _RevokeAttemptLiteLlmKeyByAlias,
	}, siloId);
	const authority = _CreateConversationComputerTurnAuthority({
		credentials,
		endpoint: process.env.LITELLM_ENDPOINT ?? "",
		history,
		keyringPath,
		maximumTurnCostUsdMicros: profile.maximumTurnCostUsdMicros,
		model: { request: __RequestConversationModel },
		prisma,
		realizer,
		runAdmission,
		runtimeAdmission,
		siloId,
	});
	const reviewer = _CreateConversationComputerTokenReviewer(authApi, profile.namespace, profile.serviceAccountName);

	return _CreateConversationComputerTurnRouter({
		logger: _log,
		authenticator: new KubernetesConversationComputerProcessAuthenticator(reviewer),
		authority,
	});
}
