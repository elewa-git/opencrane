import * as k8s from "@kubernetes/client-node";
import type { PrismaClient } from "@prisma/client";

import { _IssueAttemptLiteLlmKey, _RevokeAttemptLiteLlmKey } from "@opencrane/backend/server/gateways/model-routing";
import { _RegisterInternalAgentRuntimeStream } from "@opencrane/backend/server/infra/agent-runtime-stream";
import { PrismaAgentRunWarmRuntimeUnitOfWork, PrismaWarmRuntimeBindingUnitOfWork, __CreateAgentRunWorkflowControllerRouter, __CreateWarmRuntimeBindingRouter, type AttemptModelKeyIssuerWithRevocation, type AttemptModelKeyMintRequest, type MintedAttemptModelKey } from "@opencrane/backend/agents/execution/runs";
import { PrismaRuntimeContinuationAuthorityUnitOfWork, RuntimeExternalActionAuthorizationService, __CreateProductionRuntimeDispatchAuthority, type RuntimeContinuationAuthority, type RuntimeExternalActionEligibilityFactory } from "@opencrane/backend/agents/execution/protocol";
import { PrismaRuntimePersonalMemoryEffectEligibilityAuthority } from "@opencrane/backend/agents/personal/memory";
import { PrismaRuntimePersonaEffectEligibilityAuthority } from "@opencrane/backend/agents/personal/personas";
import { PrismaRuntimeAgentEffectEligibilityAuthority } from "@opencrane/backend/server/agents/agent-services";
import { PrismaRuntimeMcpEffectEligibilityAuthority } from "@opencrane/backend/server/gateways/mcp";
import { PrismaRuntimeMembershipEligibilityAuthority, _CreateFleetMembershipEvidenceConfig } from "@opencrane/backend/server/iam/membership";
import { MountedRuntimeContinuationCipher } from "@opencrane/backend/server/infra/agent-runtime-continuation";
import { CONVERSATION_PROJECTION_CLOCK, CONVERSATION_PROJECTION_LIMITS } from "@opencrane/backend/conversations/projection";
import { _CreateConversationReplayRepository, PrismaAgentThreadParentDeliveryUnitOfWork, __CreateAgentThreadParentDeliveryRouter, __CreateConversationReplayRouter } from "@opencrane/backend/server/conversations";
import { PrismaChannelTargetAuthorityUnitOfWork } from "@opencrane/backend/server/agents/channel-targets";
import { _CreateArtifactPreprocessAuthority, PrismaArtifactScanUnitOfWork, __CreateArtifactPreprocessControllerRouter, __CreateArtifactPreprocessorRouter, __CreateArtifactScannerRouter } from "@opencrane/backend/server/agents/artifacts";
import { PrismaSkillAuthoringValidationControllerUnitOfWork, PrismaSkillAuthoringValidationWorkerUnitOfWork, __CreateSkillAuthoringValidationControllerRouter, __CreateSkillAuthoringValidationWorkerRouter } from "@opencrane/backend/server/agents/skills";
import { _CreateAgentControllerTokenReviewer, _CreateArtifactPreprocessorTokenReviewer, _CreateArtifactScannerTokenReviewer, _CreateSkillAuthoringValidationTokenReviewer, _CreateWarmRuntimeTokenReviewer, _ValidateIsolatedWorkloadNamespace, _ValidateRuntimeIdentityNamespaces, type RuntimeIdentityNamespaces } from "@opencrane/backend/server/infra/workload-identity";
import { PrismaConversationAssetOutputRepository, __CreateConversationAssetOutputRouter } from "@opencrane/backend/server/conversation-assets";
import type { IWorkflowEngine } from "@opencrane/backend/server/infra/workflows/contract";

import { _CreateArtifactPreprocessSourceBroker } from "../infra/artifacts/artifact-preprocess-source-broker.factory";
import { _CreateArtifactScanSourceBroker } from "../infra/artifacts/artifact-scan-source-broker.factory";
import { _CreateArtifactPreprocessOutputBroker, _CreateConversationAssetOutputAuthority, _CreateSkillAuthoringArtifactReader } from "../infra/artifacts/artifact-upload.factory";
import { _CreateChannelTargetResolver } from "./channel-target-composition";
import type { InternalRuntimeConfig } from "./config.types";
import { _ProcessShutdownSignal } from "./process-shutdown";
import { _log } from "./log";
import type { ControllerRuntimeComposition, InternalRuntimeComposition, OptionalRuntimeComposition, RuntimeProtocolComposition } from "./runtime-composition.types";

/** Rejects workflow admission only in isolated composition tests that do not supply the process engine. */
const _UnavailableWorkflowExecution: Pick<IWorkflowEngine, "spawn" | "emitEventInTransaction"> = {
	async spawn(): Promise<never>
	{
		throw new Error("workflow task admission is unavailable");
	},
	async emitEventInTransaction(): Promise<never>
	{
		throw new Error("workflow event admission is unavailable");
	},
};

/**
 * Mint one attempt-scoped LiteLLM virtual key for a claimed run attempt.
 *
 * This binds the workflow authority's injected issuer to the model-routing gateway, which holds
 * the LiteLLM master key. Keeping the call here (not in the `scope:execution-runs` library) is why the
 * master key never reaches the outbound-only controller: only the minted virtual key rides the claim
 * response. The per-silo server already targets its own silo LiteLLM, so `siloId` needs no routing.
 * @param request - Alias, single model alias, silo, budget, and expiry the key is bound to.
 * @returns The transient minted key value.
 */
const _IssueAttemptModelKey: AttemptModelKeyIssuerWithRevocation = Object.assign(
	async function _IssueAttemptModelKey(request: AttemptModelKeyMintRequest): Promise<MintedAttemptModelKey>
	{
		const minted = await _IssueAttemptLiteLlmKey({ keyAlias: request.keyAlias, modelAlias: request.modelAlias, maxBudgetUsd: request.maxBudgetUsd, expirySeconds: request.expirySeconds });
		return { key: minted.key };
	},
	{
		async revokeAttemptKey(request: { readonly keyAlias: string; readonly key: string }): Promise<void>
		{
			await _RevokeAttemptLiteLlmKey(request);
		},
	},
);

/**
 * Bind the AgentRun and skill-validation workflows to one reviewed controller identity.
 *
 * Both routers run in the trusted server namespace. Keeping their repositories together makes the
 * shared claim lease explicit without giving either controller endpoint runtime-stream authority.
 *
 * @param prisma - The main product database client.
 * @param config - Frozen leases and assignment limits.
 * @param namespaces - Validated server, personal-runtime, and managed-runtime identity planes.
 * @param tokenReviewer - Reviewer fixed to the sole agent-controller ServiceAccount.
 * @returns Controller routers with no runtime or worker routes.
 */
function _CreateControllerRuntimeComposition(prisma: PrismaClient, config: InternalRuntimeConfig, namespaces: RuntimeIdentityNamespaces, tokenReviewer: ReturnType<typeof _CreateAgentControllerTokenReviewer>, continuationAuthority: RuntimeContinuationAuthority): ControllerRuntimeComposition
{
	const authoringNamespace = _ValidateIsolatedWorkloadNamespace(config.skillAuthoringNamespace, namespaces.serverNamespace);
	const warmAgentRunWorkflowAuthority = new PrismaAgentRunWarmRuntimeUnitOfWork(prisma, {
		personalRuntimeNamespace: namespaces.personalRuntimeNamespace,
		managedRuntimeNamespace: namespaces.managedRuntimeNamespace,
		assignmentTtlMilliseconds: config.assignmentTtlMilliseconds,
		issueAttemptModelKey: _IssueAttemptModelKey,
		continuationRecovery: continuationAuthority,
	});
	return {
		agentRunWorkflowController: __CreateAgentRunWorkflowControllerRouter({
			tokenReviewer,
			namespace: namespaces.serverNamespace,
			warmAuthority: warmAgentRunWorkflowAuthority,
			logger: _log,
		}),
		skillAuthoringValidationController: __CreateSkillAuthoringValidationControllerRouter({
			tokenReviewer,
			namespace: namespaces.serverNamespace,
			authoringNamespace,
			authority: new PrismaSkillAuthoringValidationControllerUnitOfWork(prisma),
			logger: _log,
		}),
	};
}

/**
 * Bind the personal and managed warm-runtime protocol to one shared workload reviewer.
 *
 * Streaming applies the same plane boundary. The durable dispatch authority stays here because it
 * owns the server-side interpretation of runtime candidates, never the runtime Pod.
 *
 * Every router here shares the one warm-runtime reviewer, which is the point: whatever a running agent
 * sends the server — a stream candidate, a generated file, or an Agent-thread delivery to a parent
 * group message — is admitted against the same two runtime namespaces. The
 * authorities behind them are built here rather than inside those libraries because they need this
 * process's Prisma client and logger, and because none of them may be reachable from a browser router.
 *
 * @param prisma - The main product database client.
 * @param config - Frozen command time-to-live and recovery settings.
 * @param namespaces - Validated server, personal-runtime, and managed-runtime identity planes.
 * @param tokenReviewer - Reviewer constrained to the two warm-runtime identity planes.
 * @returns The warm-runtime stream, conversation-file output, and Agent-thread parent-delivery routers.
 */
function _CreateRuntimeProtocolComposition(prisma: PrismaClient, config: InternalRuntimeConfig, namespaces: RuntimeIdentityNamespaces, tokenReviewer: ReturnType<typeof _CreateWarmRuntimeTokenReviewer>, continuationAuthority: RuntimeContinuationAuthority): RuntimeProtocolComposition
{
	const eligibility: RuntimeExternalActionEligibilityFactory = {
		bind(transaction)
		{
			return {
				agentService: new PrismaRuntimeAgentEffectEligibilityAuthority(transaction),
				membership: new PrismaRuntimeMembershipEligibilityAuthority(transaction, _CreateFleetMembershipEvidenceConfig()),
				mcp: new PrismaRuntimeMcpEffectEligibilityAuthority(transaction),
				personalMemory: new PrismaRuntimePersonalMemoryEffectEligibilityAuthority(transaction),
				persona: new PrismaRuntimePersonaEffectEligibilityAuthority(transaction),
			};
		},
	};
	const runtimeDispatchAuthority = __CreateProductionRuntimeDispatchAuthority(prisma, {
		personalRuntimeNamespace: namespaces.personalRuntimeNamespace,
		managedRuntimeNamespace: namespaces.managedRuntimeNamespace,
		commandTtlMilliseconds: config.commandTtlMilliseconds,
	}, continuationAuthority, new RuntimeExternalActionAuthorizationService(eligibility));
	return {
		warmRuntimeBinding: __CreateWarmRuntimeBindingRouter({ tokenReviewer, authority: new PrismaWarmRuntimeBindingUnitOfWork(prisma, { assignmentTtlMilliseconds: config.assignmentTtlMilliseconds, issueAttemptModelKey: _IssueAttemptModelKey }), logger: _log }),
		warmRuntimeStream: _RegisterInternalAgentRuntimeStream({
			tokenReviewer,
			authority: runtimeDispatchAuthority,
			maxBodyBytes: 64 * 1024,
			heartbeatMilliseconds: 15_000,
			commandRecoveryMilliseconds: config.commandRecoveryMilliseconds,
		}),
		conversationAssetOutputs: __CreateConversationAssetOutputRouter({
			tokenReviewer,
			authority: _CreateConversationAssetOutputAuthority(prisma, process.env, config.artifactScannerEnabled),
			logger: _log,
		}),
		agentThreadParentDeliveries: __CreateAgentThreadParentDeliveryRouter({ tokenReviewer, authority: new PrismaAgentThreadParentDeliveryUnitOfWork(prisma, _log), logger: _log }),
	};
}

/**
 * Bind optional worker and replay capabilities without changing the always-present runtime boundary.
 *
 * Each optional route validates its own deployment switch before a router exists. A missing switch
 * therefore leaves the capability unreachable instead of mounting a partially configured endpoint.
 *
 * @param prisma - The main product database client.
 * @param authApi - Kubernetes TokenReview client for worker identity.
 * @param config - Frozen worker and replay configuration.
 * @param serverNamespace - Namespace containing the trusted server identity.
 * @returns Optional artifact-preprocessor and conversation-replay routers.
 */
function _CreateOptionalRuntimeComposition(prisma: PrismaClient, authApi: k8s.AuthenticationV1Api, config: InternalRuntimeConfig, serverNamespace: string, controllerTokenReviewer: ReturnType<typeof _CreateAgentControllerTokenReviewer>, workflowExecution: Pick<IWorkflowEngine, "spawn" | "emitEventInTransaction">): OptionalRuntimeComposition
{
	const artifactPreprocessorNamespace = config.artifactPreprocessorEnabled
		? _ValidateIsolatedWorkloadNamespace(config.artifactPreprocessorNamespace, serverNamespace)
		: null;
	const artifactScannerNamespace = config.artifactScannerEnabled
		? _ValidateIsolatedWorkloadNamespace(config.artifactScannerNamespace, serverNamespace)
		: null;
	const artifactPreprocessRepository = _CreateArtifactPreprocessAuthority(prisma);
	return {
		artifactPreprocessController: artifactPreprocessorNamespace === null
			? null
			: __CreateArtifactPreprocessControllerRouter({
				tokenReviewer: controllerTokenReviewer,
				namespace: serverNamespace,
				workerNamespace: artifactPreprocessorNamespace,
				authority: artifactPreprocessRepository,
				logger: _log,
			}),
		channelTargetResolver: config.channelTargets === null
			? null
			: _CreateChannelTargetResolver(prisma, authApi, config.channelTargets, serverNamespace),
		conversationReplay: config.channelTargets === null
			? null
			: __CreateConversationReplayRouter({
				contexts: new PrismaChannelTargetAuthorityUnitOfWork(prisma),
				repository: _CreateConversationReplayRepository(prisma),
				clock: CONVERSATION_PROJECTION_CLOCK,
				limits: CONVERSATION_PROJECTION_LIMITS,
				shutdownSignal: _ProcessShutdownSignal,
				expectedReceiverId: config.channelTargets.receiverId,
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
		artifactScanner: artifactScannerNamespace === null
			? null
			: __CreateArtifactScannerRouter({
				authority: new PrismaArtifactScanUnitOfWork(prisma, config.artifactScannerClaimLeaseMilliseconds, function _ConversationAssets(transaction) { return new PrismaConversationAssetOutputRepository(transaction); }, workflowExecution),
				tokenReviewer: _CreateArtifactScannerTokenReviewer(authApi, artifactScannerNamespace),
				sourceBroker: _CreateArtifactScanSourceBroker(),
				expectedNamespace: artifactScannerNamespace,
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
 * This runs once while the internal listener is built, and everything it constructs — reviewers,
 * repositories, unit-of-work authorities, routers — lives as long as the process. So nothing built
 * here may hold state belonging to a single request or a single caller; per-request work stays inside
 * the router handlers.
 *
 * Called by: `_RegisterInternalRoutes` in routes.ts, which is called by internal-app.ts.
 *
 * @param prisma - The main product database client.
 * @param authApi - Kubernetes TokenReview client for workload identity.
 * @param config - Frozen startup configuration shared with the internal body parser and workers.
 * @returns Routers composed from controller, runtime, and optional-worker plane authorities.
 */
export function _CreateInternalRuntimeComposition(prisma: PrismaClient, authApi: k8s.AuthenticationV1Api, config: InternalRuntimeConfig, workflowExecution: Pick<IWorkflowEngine, "spawn" | "emitEventInTransaction"> = _UnavailableWorkflowExecution): InternalRuntimeComposition
{
	// 1. Validate all identity planes before constructing a router, so malformed coordinates fail
	// startup rather than leaving a partially mounted internal API.
	const namespaces = _ValidateRuntimeIdentityNamespaces(config);

	// 2. Create reviewers once and pass each only to its matching caller plane; neighbouring routes
	// cannot silently reinterpret a controller, validation worker, or runtime identity.
	const controllerTokenReviewer = _CreateAgentControllerTokenReviewer(authApi, namespaces.serverNamespace);
	const skillAuthoringValidationTokenReviewer = _CreateSkillAuthoringValidationTokenReviewer(authApi, config.skillAuthoringNamespace);
	const warmRuntimeTokenReviewer = _CreateWarmRuntimeTokenReviewer(authApi, namespaces);
	const continuationCipher = new MountedRuntimeContinuationCipher(config.continuationKeyringPath);
	const continuationAuthority = new PrismaRuntimeContinuationAuthorityUnitOfWork(prisma, {
		personalRuntimeNamespace: namespaces.personalRuntimeNamespace,
		managedRuntimeNamespace: namespaces.managedRuntimeNamespace,
		commandTtlMilliseconds: config.commandTtlMilliseconds,
	}, continuationCipher, _log);

	// 3. Compose only named routers; `routes.ts` remains the single readable map of internal paths.
	const skillAuthoringValidationWorker = __CreateSkillAuthoringValidationWorkerRouter({ tokenReviewer: skillAuthoringValidationTokenReviewer, authority: new PrismaSkillAuthoringValidationWorkerUnitOfWork(prisma), artifactReader: _CreateSkillAuthoringArtifactReader(prisma), logger: _log });
	return {
		..._CreateControllerRuntimeComposition(prisma, config, namespaces, controllerTokenReviewer, continuationAuthority),
		skillAuthoringValidationWorker,
		..._CreateRuntimeProtocolComposition(prisma, config, namespaces, warmRuntimeTokenReviewer, continuationAuthority),
		..._CreateOptionalRuntimeComposition(prisma, authApi, config, namespaces.serverNamespace, controllerTokenReviewer, workflowExecution),
	};
}
