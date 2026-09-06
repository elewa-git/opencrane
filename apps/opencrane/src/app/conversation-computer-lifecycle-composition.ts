import type * as k8s from "@kubernetes/client-node";
import type { PrismaClient } from "@prisma/client";
import { ConversationComputerCheckpointAuthority, ConversationComputerCheckpointFenceAdapter, ConversationComputerHistory, ConversationComputerLifecycleAuthority, ConversationComputerLifecycleDueEnumerator, ConversationComputerLifecycleScheduler, ConversationComputerLifecycleWorker, HttpConversationComputerCheckpointSandbox, KeyedConversationComputerReviewCredentialDeriver, KurrentConversationComputerActivityReader, PrismaConversationComputerLifecycleProjectionRepository, _CreateConversationComputerCheckpointRouter } from "@opencrane/backend/server/conversations";
import { AgentSandboxClaimAdapter, AgentSandboxPodBindingAdapter } from "@opencrane/backend/server/infra/agent-sandbox";
import type { HistoryStore } from "@opencrane/backend/server/infra/history-store";
import { ___RunInPrismaUnitOfWork } from "@opencrane/backend/server/infra/prisma-unit-of-work";
import { _CreateConversationComputerTokenReviewer } from "@opencrane/backend/server/infra/workload-identity";

import type { AgentSandboxReleaseProfileConfig } from "./config.types";
import type { ConversationComputerActivationWorker } from "./conversation-computer-activation-composition.types";
import { _ReadConversationPrivatePayloadKeyring } from "./conversation-history-composition";
import { _log } from "./log";
import { _CreateArtifactUploadGateway, _CreatePublishedArtifactReader } from "../infra/artifacts/artifact-upload.factory";

/** Fixed idle timings admitted by release 0.11; the lease lifetime joins them from the release profile. */
const _IDLE_POLICY = { staleAfterMilliseconds: 300_000, retireAfterMilliseconds: 1_200_000 };
const _CHECKPOINT_POLICY = { format: "opencrane-workspace-tar-v1", maximumBytes: 64 * 1024 * 1024, uploadLeaseSeconds: 300 };

/** Compose checkpoint transport, exact Pod fencing, restore route, and bounded lifecycle scheduler. */
export function _CreateConversationComputerLifecycleComposition(prisma: PrismaClient, historyStore: HistoryStore, authApi: k8s.AuthenticationV1Api, coreApi: k8s.CoreV1Api, customApi: k8s.CustomObjectsApi, siloId: string, profile: AgentSandboxReleaseProfileConfig, keyringPath: string, workflow: Parameters<typeof _CreateArtifactUploadGateway>[1]): { readonly router: import("express").Router; readonly worker: ConversationComputerActivationWorker }
{
	const history = new ConversationComputerHistory(historyStore);
	const projections = new PrismaConversationComputerLifecycleProjectionRepository(prisma);
	const pods = new AgentSandboxPodBindingAdapter(coreApi, customApi);
	const sandbox = new HttpConversationComputerCheckpointSandbox(KeyedConversationComputerReviewCredentialDeriver.fromKeyring(_ReadConversationPrivatePayloadKeyring(keyringPath)));
	const fence = new ConversationComputerCheckpointFenceAdapter({ projections, history, pods, profile });
	const checkpoints = new ConversationComputerCheckpointAuthority(sandbox, projections, _CreateArtifactUploadGateway(prisma, workflow), _CreatePublishedArtifactReader(prisma), fence, _CHECKPOINT_POLICY);
	const attempts = {
		clearActiveLease: function _ClearActiveLease(command: Parameters<typeof projections.clearActiveLease>[0]) { return ___RunInPrismaUnitOfWork(prisma, function _InTransaction(transaction) { const repository = new PrismaConversationComputerLifecycleProjectionRepository(transaction); return repository.clearActiveLease(command); }, { isolationLevel: "Serializable", operation: "conversation computer active lease clear" }); },
		extendActiveLease: function _ExtendActiveLease(command: Parameters<typeof projections.extendActiveLease>[0]) { return ___RunInPrismaUnitOfWork(prisma, function _InTransaction(transaction) { const repository = new PrismaConversationComputerLifecycleProjectionRepository(transaction); return repository.extendActiveLease(command); }, { isolationLevel: "Serializable", operation: "conversation computer active lease renewal" }); },
	};
	const policy = { ..._IDLE_POLICY, leaseTtlMilliseconds: profile.leaseTtlMilliseconds };
	const claims = new AgentSandboxClaimAdapter(customApi);
	const activity = new KurrentConversationComputerActivityReader(historyStore);
	const authority = new ConversationComputerLifecycleAuthority(history, checkpoints, attempts, claims, activity, profile.namespace, policy);
	const enumerator = new ConversationComputerLifecycleDueEnumerator(projections, history, activity, claims, siloId, profile.namespace, policy);
	const scheduler = new ConversationComputerLifecycleScheduler(enumerator, authority, 50);
	return { router: _CreateConversationComputerCheckpointRouter({ authority: checkpoints, siloId, tokenReviewer: _CreateConversationComputerTokenReviewer(authApi, profile.namespace, profile.serviceAccountName) }), worker: new ConversationComputerLifecycleWorker(scheduler, _log) };
}
