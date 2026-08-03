import * as k8s from "@kubernetes/client-node";
import type { PrismaClient } from "@prisma/client";

import { _IssueAttemptLiteLlmKey } from "@opencrane/backend/server/gateways/model-routing";
import { _RegisterInternalAgentRuntimeStream } from "@opencrane/server/_infra/agent-runtime-stream";
import { PrismaRunDispatchRepository, __CreateAgentControllerRunDispatchRouter, type AttemptModelKeyMintRequest, type MintedAttemptModelKey } from "@opencrane/backend/agents/execution/runs";
import { PrismaSkillAuthoringCompletionRepository, PrismaSkillAuthoringInputRepository, PrismaSkillWorkloadBootstrapRepository, PrismaSkillWorkloadClaimsRepository, __CreateSkillAuthoringCompletionRouter, __CreateSkillAuthoringInputRouter, __CreateSkillWorkloadBootstrapRouter, __CreateSkillWorkloadDispatchRouter } from "@opencrane/backend/agents/skills/execution";
import { __CreateProductionRuntimeDispatchAuthority } from "@opencrane/backend/agents/execution/protocol";
import { PrismaRuntimeBootstrapExchange, __CreateRuntimeBootstrapRouter } from "@opencrane/backend/server/iam/authorization";
import { __CreateConversationReplayRouter, PrismaConversationReplayRepository } from "@opencrane/backend/server/agents/conversation-replay";
import { PrismaChannelTargetAuthorityRepository } from "@opencrane/backend/server/agents/channel-targets";
import { PrismaArtifactPreprocessRepository, __CreateArtifactPreprocessorRouter } from "@opencrane/backend/server/agents/artifacts";
import { _CreateAgentControllerTokenReviewer, _CreateArtifactPreprocessorTokenReviewer, _CreateRuntimeTokenReviewer, _CreateSkillWorkloadTokenReviewer, _ValidateIsolatedWorkloadNamespace, _ValidateRuntimeIdentityNamespaces } from "@opencrane/server/_infra/workload-identity";
import type { RuntimeIdentityNamespaces } from "@opencrane/server/_infra/workload-identity";

import { _CreateArtifactPreprocessOutputBroker, _CreateArtifactPreprocessSourceBroker, _CreateSkillAuthoringArtifactReader } from "../infra/artifacts/artifact-upload.factory.js";
import { _CreateExternalActionPorts } from "../infra/transports/external-action-ports.factory.js";
import type { InternalRuntimeConfig } from "./config.types.js";
import { _log } from "./log.js";
import type { InternalRuntimeAuthorities, InternalRuntimeComposition, InternalRuntimeIdentity, InternalRuntimeClock } from "./runtime-composition.types.js";

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

/** Validate startup identity coordinates before any internal router can be constructed. */
function _ValidateInternalRuntimeIdentity(config: InternalRuntimeConfig): InternalRuntimeIdentity
{
	return _ValidateRuntimeIdentityNamespaces(config);
}

/** Build authorities once so every internal route shares the same identity and dispatch fences. */
function _CreateInternalRuntimeAuthorities(prisma: PrismaClient, authApi: k8s.AuthenticationV1Api, config: InternalRuntimeConfig, identity: InternalRuntimeIdentity): InternalRuntimeAuthorities
{
	const runtimePlanes: RuntimeIdentityNamespaces = { personalRuntimeNamespace: identity.personalRuntimeNamespace, managedRuntimeNamespace: identity.managedRuntimeNamespace, serverNamespace: identity.serverNamespace };
	return {
		controllerTokenReviewer: _CreateAgentControllerTokenReviewer(authApi, identity.serverNamespace),
		skillWorkloadTokenReviewer: _CreateSkillWorkloadTokenReviewer(authApi),
		runtimeTokenReviewer: _CreateRuntimeTokenReviewer(authApi, runtimePlanes),
		runDispatchRepository: new PrismaRunDispatchRepository(prisma, { personalRuntimeNamespace: identity.personalRuntimeNamespace, managedRuntimeNamespace: identity.managedRuntimeNamespace, claimLeaseMilliseconds: config.claimLeaseMilliseconds, assignmentTtlMilliseconds: config.assignmentTtlMilliseconds, publishedOutboxRetentionMilliseconds: config.publishedOutboxRetentionMilliseconds, outboxPruneBatchSize: config.outboxPruneBatchSize }, _IssueAttemptModelKey),
		runtimeDispatchAuthority: __CreateProductionRuntimeDispatchAuthority(prisma, { personalRuntimeNamespace: identity.personalRuntimeNamespace, managedRuntimeNamespace: identity.managedRuntimeNamespace, commandTtlMilliseconds: config.commandTtlMilliseconds, externalActionRetryLimit: 3, externalActionRetryWindowMilliseconds: 30_000 }, _log, _CreateExternalActionPorts(prisma, config)),
	};
}

/** Build the optional conversation replay router only when startup configuration selects a route. */
function _CreateConversationReplayRoute(prisma: PrismaClient, routeId: string | null): ReturnType<typeof __CreateConversationReplayRouter> | null
{
	if (routeId === null) return null;
	return __CreateConversationReplayRouter({ contexts: new PrismaChannelTargetAuthorityRepository(prisma), repository: new PrismaConversationReplayRepository(prisma), expectedRouteId: routeId, nowEpochMs: function _now() { return Date.now(); } });
}

/** Build the restricted preprocessing router only after its namespace has been isolated from the server. */
function _CreateArtifactPreprocessorRoute(prisma: PrismaClient, authApi: k8s.AuthenticationV1Api, config: InternalRuntimeConfig, serverNamespace: string): ReturnType<typeof __CreateArtifactPreprocessorRouter> | null
{
	if (!config.artifactPreprocessorEnabled) return null;
	const namespace = _ValidateIsolatedWorkloadNamespace(config.artifactPreprocessorNamespace, serverNamespace);
	return __CreateArtifactPreprocessorRouter({ tokenReviewer: _CreateArtifactPreprocessorTokenReviewer(authApi, namespace), namespace, repository: new PrismaArtifactPreprocessRepository(prisma), sourceBroker: _CreateArtifactPreprocessSourceBroker(prisma), outputBroker: _CreateArtifactPreprocessOutputBroker(prisma, config.artifactPreprocessorMaximumOutputBytes), logger: _log });
}

/** Build the concrete routers while leaving transport path selection to `routes.ts`. */
function _CreateInternalRuntimeRoutes(prisma: PrismaClient, authApi: k8s.AuthenticationV1Api, config: InternalRuntimeConfig, identity: InternalRuntimeIdentity, authorities: InternalRuntimeAuthorities): InternalRuntimeComposition
{
	const skillWorkloadRepository = new PrismaSkillWorkloadClaimsRepository(prisma, config.claimLeaseMilliseconds);
	return {
		conversationReplay: _CreateConversationReplayRoute(prisma, config.channelReplayRouteId),
		agentControllerRunDispatch: __CreateAgentControllerRunDispatchRouter({ tokenReviewer: authorities.controllerTokenReviewer, namespace: identity.serverNamespace, repository: authorities.runDispatchRepository, logger: _log }),
		skillWorkloadDispatch: __CreateSkillWorkloadDispatchRouter({ tokenReviewer: authorities.controllerTokenReviewer, namespace: identity.serverNamespace, repository: skillWorkloadRepository, logger: _log }),
		skillWorkloadBootstrap: __CreateSkillWorkloadBootstrapRouter({ tokenReviewer: authorities.skillWorkloadTokenReviewer, repository: new PrismaSkillWorkloadBootstrapRepository(prisma), logger: _log }),
		skillAuthoringInput: __CreateSkillAuthoringInputRouter({ tokenReviewer: authorities.skillWorkloadTokenReviewer, repository: new PrismaSkillAuthoringInputRepository(prisma), artifactReader: _CreateSkillAuthoringArtifactReader(prisma), logger: _log }),
		skillAuthoringCompletion: __CreateSkillAuthoringCompletionRouter({ tokenReviewer: authorities.skillWorkloadTokenReviewer, repository: new PrismaSkillAuthoringCompletionRepository(prisma), logger: _log }),
		artifactPreprocessor: _CreateArtifactPreprocessorRoute(prisma, authApi, config, identity.serverNamespace),
		runtimeBootstrap: __CreateRuntimeBootstrapRouter({ tokenReviewer: authorities.runtimeTokenReviewer, runtimeNamespaces: [identity.personalRuntimeNamespace, identity.managedRuntimeNamespace], repository: new PrismaRuntimeBootstrapExchange(prisma), clock: _CreateRuntimeClock(), logger: _log }),
		runtimeStream: _RegisterInternalAgentRuntimeStream({ tokenReviewer: authorities.runtimeTokenReviewer, authority: authorities.runtimeDispatchAuthority, maxBodyBytes: 64 * 1024, heartbeatMilliseconds: 15_000, commandRecoveryMilliseconds: config.commandRecoveryMilliseconds }),
	};
}

/** Supply one process clock implementation to every router that needs database-independent time. */
function _CreateRuntimeClock(): InternalRuntimeClock
{
	return { nowEpochMs: function _now() { return Date.now(); } };
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
	// 1. Validate identity coordinates before constructing any authority or router.
	const identity = _ValidateInternalRuntimeIdentity(config);
	// 2. Share reviewed identities and durable fences across all internal capabilities.
	const authorities = _CreateInternalRuntimeAuthorities(prisma, authApi, config, identity);
	// 3. Assemble routers; `routes.ts` remains the only module that chooses URL paths.
	return _CreateInternalRuntimeRoutes(prisma, authApi, config, identity, authorities);
}
