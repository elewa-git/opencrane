import type * as k8s from "@kubernetes/client-node";
import type { PrismaClient } from "@prisma/client";
import { ConversationComputerCheckpointAuthority, ConversationComputerCheckpointFenceAdapter, ConversationComputerLifecycleAuthority, ConversationComputerLifecycleDueEnumerator, ConversationComputerLifecycleScheduler, ConversationComputerLifecycleWorker, HttpConversationComputerCheckpointSandbox, KeyedConversationComputerReviewCredentialDeriver, KurrentConversationComputerActivityReader, PrismaConversationComputerLifecycleProjectionRepository, PrismaConversationComputerLifecycleUnitOfWork, _CreateConversationComputerCheckpointRouter } from "@opencrane/backend/server/conversations";
import { ConversationComputerHistory } from "@opencrane/backend/server/conversations/computers";
import { AgentSandboxClaimAdapter, AgentSandboxPodBindingAdapter } from "@opencrane/backend/server/infra/agent-sandbox";
import type { HistoryStore } from "@opencrane/backend/server/infra/history-store";
import { _CreateConversationComputerTokenReviewer } from "@opencrane/backend/server/infra/workload-identity";

import type { AgentSandboxReleaseProfileConfig } from "../configuration/config.types";
import type { ConversationComputerActivationWorker } from "@opencrane/backend/server/conversations";
import { _ReadConversationPrivatePayloadKeyring } from "@opencrane/backend/server/conversations/history";
import { _log } from "../process/log";
import { _CreateArtifactUploadGateway, _CreatePublishedArtifactReader } from "@opencrane/backend/server/agents/artifacts";

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
	const attempts = new PrismaConversationComputerLifecycleUnitOfWork(prisma);
	const policy = { ..._IDLE_POLICY, leaseTtlMilliseconds: profile.leaseTtlMilliseconds };
	const claims = new AgentSandboxClaimAdapter(customApi);
	const activity = new KurrentConversationComputerActivityReader(historyStore);
	const authority = new ConversationComputerLifecycleAuthority(history, checkpoints, attempts, claims, activity, profile.namespace, policy);
	const enumerator = new ConversationComputerLifecycleDueEnumerator(projections, history, activity, claims, siloId, profile.namespace, policy);
	const scheduler = new ConversationComputerLifecycleScheduler(enumerator, authority, 50);
	return { router: _CreateConversationComputerCheckpointRouter({ authority: checkpoints, siloId, tokenReviewer: _CreateConversationComputerTokenReviewer(authApi, profile.namespace, profile.serviceAccountName) }), worker: new ConversationComputerLifecycleWorker(scheduler, _log) };
}
