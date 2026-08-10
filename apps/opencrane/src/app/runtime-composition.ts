import * as k8s from "@kubernetes/client-node";
import type { PrismaClient } from "@prisma/client";

import { _IssueAttemptLiteLlmKey } from "@opencrane/backend/server/gateways/model-routing";
import { PrismaIntegrationAuthorityRepository, __SystemIntegrationAuthorityClock, type IntegrationAuthorityRepository } from "@opencrane/backend/server/gateways/integrations";
import { _RegisterInternalAgentRuntimeStream } from "@opencrane/backend/server/infra/agent-runtime-stream";
import { PrismaRunDispatchRepository, __CreateAgentControllerRunDispatchRouter, type AttemptModelKeyMintRequest, type AttemptObotKeyIssuer, type AttemptObotKeyMintRequest, type MintedAttemptModelKey, type MintedAttemptObotKey } from "@opencrane/backend/agents/execution/runs";
import type { ObotAttemptKeyIssuer } from "@opencrane/backend/server/infra/obot-custody";
import { PrismaSkillWorkloadUnitOfWork, _CreateSkillWorkloadExecutionAuthority, __CreateSkillAuthoringCompletionRouter, __CreateSkillAuthoringInputRouter, __CreateSkillWorkloadBootstrapRouter, __CreateSkillWorkloadDispatchRouter } from "@opencrane/backend/agents/skills/execution";
import { __CreateProductionRuntimeDispatchAuthority } from "@opencrane/backend/agents/execution/protocol";
import { PrismaRuntimeBootstrapExchange, __CreateRuntimeBootstrapRouter } from "@opencrane/backend/server/iam/authorization";
import { CONVERSATION_LIVE_REPLAY_CLOCK, CONVERSATION_LIVE_REPLAY_LIMITS, _CreateConversationReplayRepository, __CreateConversationReplayRouter } from "@opencrane/backend/server/conversations";
import { PrismaChannelTargetAuthorityUnitOfWork } from "@opencrane/backend/server/agents/channel-targets";
import { _CreateArtifactPreprocessAuthority, __CreateArtifactPreprocessorRouter } from "@opencrane/backend/server/agents/artifacts";
import { _CreateAgentControllerTokenReviewer, _CreateArtifactPreprocessorTokenReviewer, _CreateRuntimeTokenReviewer, _CreateSkillWorkloadTokenReviewer, _ValidateIsolatedWorkloadNamespace, _ValidateRuntimeIdentityNamespaces, type RuntimeIdentityNamespaces } from "@opencrane/backend/server/infra/workload-identity";
import type { MemoryGatewayClient } from "@opencrane/backend/server/infra/memory-gateway-client";

import { _CreateArtifactPreprocessSourceBroker } from "../infra/artifacts/artifact-preprocess-source-broker.factory.js";
import { _CreateArtifactPreprocessOutputBroker, _CreateSkillAuthoringArtifactReader } from "../infra/artifacts/artifact-upload.factory.js";
import type { InternalRuntimeConfig } from "./config.types.js";
import { _log } from "./log.js";
import type { ControllerRuntimeComposition, InternalRuntimeComposition, OptionalRuntimeComposition, RuntimeProtocolComposition, SkillWorkloadRuntimeComposition } from "./runtime-composition.types.js";

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
 * Bind the optional attempt-scoped Obot key issuer to the integrations authority and Obot transport.
 *
 * Mirrors {@link _IssueAttemptModelKey}: the Obot service credential stays server-side, only the
 * minted attempt key rides the claim response. Every integration frozen into the snapshot is
 * re-resolved to its live custody reference here, so a revoked or expired assignment fails the mint
 * (and therefore the claim) instead of producing a key with narrower scope than the snapshot's tools.
 *
 * @param integrations - Shared live integration-custody resolver constructed by this composition.
 * @param attemptKeys - Composed Obot attempt-key issuer, or null when the deployment leaves Obot off.
 * @returns The dispatch-repository issuer, or null so no attempt carries an Obot credential.
 */
function _CreateAttemptObotKeyIssuer(integrations: IntegrationAuthorityRepository, attemptKeys: ObotAttemptKeyIssuer | null): AttemptObotKeyIssuer | null
{
	if (attemptKeys === null) return null;
	return async function _IssueAttemptObotKey(request: AttemptObotKeyMintRequest): Promise<MintedAttemptObotKey>
	{
		// 1. Resolve every snapshot integration to its live custody reference; any unavailable
		// assignment fails the mint so the key scope always matches the compiled tool set.
		const references: string[] = [];
		for (const integrationId of request.integrationIds)
		{
			const resolved = await integrations.resolveAssignment({ siloId: request.siloId, agentRevisionId: request.agentRevisionId, integrationId });
			if (resolved.outcome !== "resolved") throw new Error(`attempt Obot key cannot scope integration '${integrationId}': ${resolved.reason}`);
			references.push(resolved.assignment.obotCustodyReference);
		}

		// 2. Mint ONE key scoped to exactly those MCP server ids, expiring with the assignment lease.
		const issued = await attemptKeys.issueAttemptKey({ obotCustodyReferences: references, name: request.keyName, expiresAt: request.expiresAt });
		return { key: issued.key, keyId: issued.keyId };
	};
}

/**
 * Bind the two controller-only dispatch routers to one reviewed controller identity.
 *
 * Both routers run in the trusted server namespace. Keeping their repositories together makes the
 * shared claim lease explicit without giving either controller endpoint runtime-stream authority.
 *
 * @param prisma - Canonical product-authority database client.
 * @param config - Frozen leases, assignment limits, and outbox-retention settings.
 * @param namespaces - Validated server, personal-runtime, and managed-runtime identity planes.
 * @param tokenReviewer - Reviewer fixed to the sole agent-controller ServiceAccount.
 * @param integrationAuthority - Shared live integration-custody resolver.
 * @param obotAttemptKeys - Optional Obot attempt-key issuer composed by the app root.
 * @returns Controller dispatch routers with no runtime or worker routes.
 */
function _CreateControllerRuntimeComposition(prisma: PrismaClient, config: InternalRuntimeConfig, namespaces: RuntimeIdentityNamespaces, tokenReviewer: ReturnType<typeof _CreateAgentControllerTokenReviewer>, integrationAuthority: IntegrationAuthorityRepository, obotAttemptKeys: ObotAttemptKeyIssuer | null, skillWorkloadAuthority: ReturnType<typeof _CreateSkillWorkloadExecutionAuthority>): ControllerRuntimeComposition
{
	const runDispatchRepository = new PrismaRunDispatchRepository(prisma, {
		personalRuntimeNamespace: namespaces.personalRuntimeNamespace,
		managedRuntimeNamespace: namespaces.managedRuntimeNamespace,
		claimLeaseMilliseconds: config.claimLeaseMilliseconds,
		assignmentTtlMilliseconds: config.assignmentTtlMilliseconds,
		publishedOutboxRetentionMilliseconds: config.publishedOutboxRetentionMilliseconds,
		outboxPruneBatchSize: config.outboxPruneBatchSize,
	}, _IssueAttemptModelKey, _CreateAttemptObotKeyIssuer(integrationAuthority, obotAttemptKeys));
	return {
		agentControllerRunDispatch: __CreateAgentControllerRunDispatchRouter({
			tokenReviewer,
			namespace: namespaces.serverNamespace,
			repository: runDispatchRepository,
			logger: _log,
		}),
		skillWorkloadDispatch: __CreateSkillWorkloadDispatchRouter({
			tokenReviewer,
			namespace: namespaces.serverNamespace,
			authority: skillWorkloadAuthority,
			logger: _log,
		}),
	};
}

/**
 * Bind the isolated skill workload exchange to its generic, durable-bootstrap reviewer.
 *
 * The reviewer validates a projected identity but leaves workload selection to the repositories,
 * so the server does not turn a controller claim into a broader worker credential.
 *
 * @param prisma - Canonical product-authority database client.
 * @param tokenReviewer - Reviewer that exposes only a validated skill workload identity.
 * @returns Skill bootstrap, input, and completion routers.
 */
function _CreateSkillWorkloadRuntimeComposition(prisma: PrismaClient, tokenReviewer: ReturnType<typeof _CreateSkillWorkloadTokenReviewer>, skillWorkloadAuthority: ReturnType<typeof _CreateSkillWorkloadExecutionAuthority>): SkillWorkloadRuntimeComposition
{
	return {
		skillWorkloadBootstrap: __CreateSkillWorkloadBootstrapRouter({
			tokenReviewer,
			authority: skillWorkloadAuthority,
			logger: _log,
		}),
		skillAuthoringInput: __CreateSkillAuthoringInputRouter({
			tokenReviewer,
			authority: skillWorkloadAuthority,
			artifactReader: _CreateSkillAuthoringArtifactReader(prisma),
			logger: _log,
		}),
		skillAuthoringCompletion: __CreateSkillAuthoringCompletionRouter({
			tokenReviewer,
			authority: skillWorkloadAuthority,
			logger: _log,
		}),
	};
}

/**
 * Bind the personal and managed runtime protocol to one shared workload reviewer.
 *
 * Bootstrap and streaming must apply the same plane boundary. The durable dispatch authority stays
 * here because it owns the server-side interpretation of runtime candidates, never the runtime Job.
 *
 * @param prisma - Canonical product-authority database client.
 * @param config - Frozen command time-to-live and recovery settings.
 * @param namespaces - Validated server, personal-runtime, and managed-runtime identity planes.
 * @param tokenReviewer - Reviewer constrained to the two runtime identity planes.
 * @param memoryGateway - Authenticated memory-gateway client shared by compile-time recall and the action transport.
 * @param integrationAuthority - Shared live custody resolver compiling per-tool Obot addressing.
 * @returns Runtime bootstrap and stream routers.
 */
function _CreateRuntimeProtocolComposition(prisma: PrismaClient, config: InternalRuntimeConfig, namespaces: RuntimeIdentityNamespaces, tokenReviewer: ReturnType<typeof _CreateRuntimeTokenReviewer>, memoryGateway: MemoryGatewayClient, integrationAuthority: IntegrationAuthorityRepository): RuntimeProtocolComposition
{
	const runtimeDispatchAuthority = __CreateProductionRuntimeDispatchAuthority(prisma, {
		personalRuntimeNamespace: namespaces.personalRuntimeNamespace,
		managedRuntimeNamespace: namespaces.managedRuntimeNamespace,
		commandTtlMilliseconds: config.commandTtlMilliseconds,
		externalActionRetryLimit: 3,
		externalActionRetryWindowMilliseconds: 30_000,
	}, _log, memoryGateway, integrationAuthority);
	return {
		runtimeBootstrap: __CreateRuntimeBootstrapRouter({
			tokenReviewer,
			runtimeNamespaces: [namespaces.personalRuntimeNamespace, namespaces.managedRuntimeNamespace],
			repository: new PrismaRuntimeBootstrapExchange(prisma),
			clock: { nowEpochMs: function _nowEpochMs() { return Date.now(); } },
			logger: _log,
		}),
		runtimeStream: _RegisterInternalAgentRuntimeStream({
			tokenReviewer,
			authority: runtimeDispatchAuthority,
			maxBodyBytes: 64 * 1024,
			heartbeatMilliseconds: 15_000,
			commandRecoveryMilliseconds: config.commandRecoveryMilliseconds,
		}),
	};
}

/**
 * Bind optional worker and replay capabilities without changing the always-present runtime boundary.
 *
 * Each optional route validates its own deployment switch before a router exists. A missing switch
 * therefore leaves the capability unreachable instead of mounting a partially configured endpoint.
 *
 * @param prisma - Canonical product-authority database client.
 * @param authApi - Kubernetes TokenReview client for worker identity.
 * @param config - Frozen worker and replay configuration.
 * @param serverNamespace - Namespace containing the trusted server identity.
 * @returns Optional artifact-preprocessor and conversation-replay routers.
 */
function _CreateOptionalRuntimeComposition(prisma: PrismaClient, authApi: k8s.AuthenticationV1Api, config: InternalRuntimeConfig, serverNamespace: string): OptionalRuntimeComposition
{
	const artifactPreprocessorNamespace = config.artifactPreprocessorEnabled
		? _ValidateIsolatedWorkloadNamespace(config.artifactPreprocessorNamespace, serverNamespace)
		: null;
	const artifactPreprocessRepository = _CreateArtifactPreprocessAuthority(prisma);
	return {
		conversationReplay: config.channelReplayRouteId === null
			? null
			: __CreateConversationReplayRouter({
				contexts: new PrismaChannelTargetAuthorityUnitOfWork(prisma),
				repository: _CreateConversationReplayRepository(prisma),
				clock: CONVERSATION_LIVE_REPLAY_CLOCK,
				limits: CONVERSATION_LIVE_REPLAY_LIMITS,
				expectedRouteId: config.channelReplayRouteId,
				nowEpochMs: function _nowEpochMs() { return Date.now(); },
			}),
		artifactPreprocessor: artifactPreprocessorNamespace === null
			? null
			: __CreateArtifactPreprocessorRouter({
				tokenReviewer: _CreateArtifactPreprocessorTokenReviewer(authApi, artifactPreprocessorNamespace),
				namespace: artifactPreprocessorNamespace,
				repository: artifactPreprocessRepository,
				sourceBroker: _CreateArtifactPreprocessSourceBroker(artifactPreprocessRepository),
				outputBroker: _CreateArtifactPreprocessOutputBroker(prisma, config.artifactPreprocessorMaximumOutputBytes),
				logger: _log,
			}),
	};
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
 * @param memoryGateway - Process-wide authenticated memory-gateway client built once at startup.
 * @param obotAttemptKeys - Optional Obot attempt-key issuer composed by the app root; null disables direct invocation.
 * @returns Routers composed from controller, skill-workload, runtime, and optional-worker plane authorities.
 */
export function _CreateInternalRuntimeComposition(prisma: PrismaClient, authApi: k8s.AuthenticationV1Api, config: InternalRuntimeConfig, memoryGateway: MemoryGatewayClient, obotAttemptKeys: ObotAttemptKeyIssuer | null = null): InternalRuntimeComposition
{
	// 1. Validate all identity planes before constructing a router, so malformed coordinates fail
	// startup rather than leaving a partially mounted internal API.
	const namespaces = _ValidateRuntimeIdentityNamespaces(config);

	// 2. Create reviewers once and pass each only to its matching caller plane; neighbouring routes
	// cannot silently reinterpret a controller, skill workload, or runtime identity.
	const controllerTokenReviewer = _CreateAgentControllerTokenReviewer(authApi, namespaces.serverNamespace);
	const skillWorkloadTokenReviewer = _CreateSkillWorkloadTokenReviewer(authApi);
	const runtimeTokenReviewer = _CreateRuntimeTokenReviewer(authApi, namespaces);
	const skillWorkloadUnitOfWork = new PrismaSkillWorkloadUnitOfWork(prisma, config.claimLeaseMilliseconds);
	const skillWorkloadAuthority = _CreateSkillWorkloadExecutionAuthority(skillWorkloadUnitOfWork);

	// 3. One shared live custody resolver serves attempt-key scoping and compiled Obot addressing, so
	// the two planes can never disagree about which MCP server an assignment resolves to.
	const integrationAuthority = new PrismaIntegrationAuthorityRepository(prisma, new __SystemIntegrationAuthorityClock());

	// 4. Compose only named routers; `routes.ts` remains the single readable map of internal paths.
	return {
		..._CreateControllerRuntimeComposition(prisma, config, namespaces, controllerTokenReviewer, integrationAuthority, obotAttemptKeys, skillWorkloadAuthority),
		..._CreateSkillWorkloadRuntimeComposition(prisma, skillWorkloadTokenReviewer, skillWorkloadAuthority),
		..._CreateRuntimeProtocolComposition(prisma, config, namespaces, runtimeTokenReviewer, memoryGateway, integrationAuthority),
		..._CreateOptionalRuntimeComposition(prisma, authApi, config, namespaces.serverNamespace),
	};
}
