import * as k8s from "@kubernetes/client-node";
import type { PrismaClient } from "@prisma/client";

import { _IssueAttemptLiteLlmKey } from "@opencrane/backend/server/gateways/model-routing";
import { _RegisterInternalAgentRuntimeStream } from "@opencrane/server/_infra/agent-runtime-stream";
import { PrismaRunDispatchRepository, __CreateAgentControllerRunDispatchRouter, type AttemptModelKeyMintRequest, type MintedAttemptModelKey } from "@opencrane/backend/agents/execution/runs";
import { PrismaSkillAuthoringCompletionRepository, PrismaSkillAuthoringInputRepository, PrismaSkillWorkloadBootstrapRepository, PrismaSkillWorkloadClaimsRepository, __CreateSkillAuthoringCompletionRouter, __CreateSkillAuthoringInputRouter, __CreateSkillWorkloadBootstrapRouter, __CreateSkillWorkloadDispatchRouter } from "@opencrane/backend/agents/skills/execution";
import { __CreateProductionRuntimeDispatchAuthority } from "@opencrane/backend/agents/execution/protocol";
import { PrismaRuntimeBootstrapExchange, __CreateRuntimeBootstrapRouter } from "@opencrane/backend/server/iam/authorization";
import { _CreateConversationReplayRepository, __CreateConversationReplayRouter } from "@opencrane/backend/server/agents/conversation-replay";
import { PrismaChannelTargetAuthorityRepository } from "@opencrane/backend/server/agents/channel-targets";
import { PrismaArtifactPreprocessRepository, __CreateArtifactPreprocessorRouter } from "@opencrane/backend/server/agents/artifacts";
import { _CreateAgentControllerTokenReviewer, _CreateArtifactPreprocessorTokenReviewer, _CreateRuntimeTokenReviewer, _CreateSkillWorkloadTokenReviewer, _ValidateIsolatedWorkloadNamespace, _ValidateRuntimeIdentityNamespaces } from "@opencrane/server/_infra/workload-identity";

import { _CreateArtifactPreprocessOutputBroker, _CreateArtifactPreprocessSourceBroker, _CreateSkillAuthoringArtifactReader } from "../infra/artifacts/artifact-upload.factory.js";
import type { InternalRuntimeConfig } from "./config.types.js";
import { _log } from "./log.js";
import type { InternalRuntimeComposition } from "./runtime-composition.types.js";

/**
 * Mint one attempt-scoped LiteLLM virtual key for a claimed run attempt.
 *
 * This binds the run-dispatch repository's injected issuer to the model-routing gateway, which holds
 * the LiteLLM master key. Keeping the call here (not in the `scope:execution-runs` library) is why the
 * master key never reaches the outbound-only controller: only the minted virtual key rides the claim
 * response. The per-silo server already targets its own silo LiteLLM, so `siloId` needs no routing.
 * @param request - Alias, single model alias, silo, budget, and expiry the key is bound to.
 * @returns The transient minted key value.
 */
async function _IssueAttemptModelKey(request: AttemptModelKeyMintRequest): Promise<MintedAttemptModelKey>
{
	const minted = await _IssueAttemptLiteLlmKey({ keyAlias: request.keyAlias, modelAlias: request.modelAlias, maxBudgetUsd: request.maxBudgetUsd, expirySeconds: request.expirySeconds });
	return { key: minted.key };
}

/**
 * Compose the workload-facing routers without deciding where they are mounted.
 *
 * Keeping path selection out of this module makes the trust split visible in `routes.ts`: the
 * composition binds concrete authorities, while the route registry shows exactly which internal
 * area receives each router.
 *
 * @param prisma - Canonical product-authority database client.
 * @param authApi - Kubernetes TokenReview client for workload identity.
 * @param config - Frozen startup configuration shared with the internal body parser and workers.
 * @returns Routers sharing one runtime reviewer and dispatch authority.
 */
export function _CreateInternalRuntimeComposition(prisma: PrismaClient, authApi: k8s.AuthenticationV1Api, config: InternalRuntimeConfig): InternalRuntimeComposition
{
	// 1. Freeze process configuration before constructing any authority so malformed trust
	// coordinates fail startup rather than leaving a partially mounted internal API.
	const { serverNamespace, personalRuntimeNamespace, managedRuntimeNamespace } = _ValidateRuntimeIdentityNamespaces(config);
	const runtimePlanes = { personalRuntimeNamespace, managedRuntimeNamespace };

	// 2. Share the reviewed workload identity and durable dispatch authority across bootstrap and
	// streaming so one runtime cannot be interpreted differently by neighbouring endpoints.
	const controllerTokenReviewer = _CreateAgentControllerTokenReviewer(authApi, serverNamespace);
	const skillWorkloadTokenReviewer = _CreateSkillWorkloadTokenReviewer(authApi);
	const runtimeTokenReviewer = _CreateRuntimeTokenReviewer(authApi, runtimePlanes);
	const runDispatchRepository = new PrismaRunDispatchRepository(prisma, { ...runtimePlanes, claimLeaseMilliseconds: config.claimLeaseMilliseconds, assignmentTtlMilliseconds: config.assignmentTtlMilliseconds, publishedOutboxRetentionMilliseconds: config.publishedOutboxRetentionMilliseconds, outboxPruneBatchSize: config.outboxPruneBatchSize }, _IssueAttemptModelKey);
	const runtimeDispatchAuthority = __CreateProductionRuntimeDispatchAuthority(prisma, { ...runtimePlanes, commandTtlMilliseconds: config.commandTtlMilliseconds, externalActionRetryLimit: 3, externalActionRetryWindowMilliseconds: 30_000 }, _log);

	// 3. Return named routers only; `routes.ts` remains the single readable map of internal paths.
	const replayRouteId = config.channelReplayRouteId;
	const artifactPreprocessorNamespace = config.artifactPreprocessorEnabled
		? _ValidateIsolatedWorkloadNamespace(config.artifactPreprocessorNamespace, serverNamespace)
		: null;
	return {
		conversationReplay: replayRouteId === null
			? null
			: __CreateConversationReplayRouter({ contexts: new PrismaChannelTargetAuthorityRepository(prisma), repository: _CreateConversationReplayRepository(prisma), expectedRouteId: replayRouteId, nowEpochMs: function _now() { return Date.now(); } }),
		agentControllerRunDispatch: __CreateAgentControllerRunDispatchRouter({ tokenReviewer: controllerTokenReviewer, namespace: serverNamespace, repository: runDispatchRepository, logger: _log }),
		skillWorkloadDispatch: __CreateSkillWorkloadDispatchRouter({ tokenReviewer: controllerTokenReviewer, namespace: serverNamespace, repository: new PrismaSkillWorkloadClaimsRepository(prisma, config.claimLeaseMilliseconds), logger: _log }),
		skillWorkloadBootstrap: __CreateSkillWorkloadBootstrapRouter({ tokenReviewer: skillWorkloadTokenReviewer, repository: new PrismaSkillWorkloadBootstrapRepository(prisma), logger: _log }),
		skillAuthoringInput: __CreateSkillAuthoringInputRouter({ tokenReviewer: skillWorkloadTokenReviewer, repository: new PrismaSkillAuthoringInputRepository(prisma), artifactReader: _CreateSkillAuthoringArtifactReader(prisma), logger: _log }),
		skillAuthoringCompletion: __CreateSkillAuthoringCompletionRouter({ tokenReviewer: skillWorkloadTokenReviewer, repository: new PrismaSkillAuthoringCompletionRepository(prisma), logger: _log }),
		artifactPreprocessor: artifactPreprocessorNamespace === null
			? null
			: __CreateArtifactPreprocessorRouter({
				tokenReviewer: _CreateArtifactPreprocessorTokenReviewer(authApi, artifactPreprocessorNamespace),
				namespace: artifactPreprocessorNamespace,
				repository: new PrismaArtifactPreprocessRepository(prisma),
				sourceBroker: _CreateArtifactPreprocessSourceBroker(prisma),
				outputBroker: _CreateArtifactPreprocessOutputBroker(prisma, config.artifactPreprocessorMaximumOutputBytes),
				logger: _log,
			}),
		runtimeBootstrap: __CreateRuntimeBootstrapRouter({ tokenReviewer: runtimeTokenReviewer, runtimeNamespaces: [personalRuntimeNamespace, managedRuntimeNamespace], repository: new PrismaRuntimeBootstrapExchange(prisma), clock: { nowEpochMs(): number { return Date.now(); } }, logger: _log }),
		runtimeStream: _RegisterInternalAgentRuntimeStream({ tokenReviewer: runtimeTokenReviewer, authority: runtimeDispatchAuthority, maxBodyBytes: 64 * 1024, heartbeatMilliseconds: 15_000, commandRecoveryMilliseconds: config.commandRecoveryMilliseconds }),
	};
}
