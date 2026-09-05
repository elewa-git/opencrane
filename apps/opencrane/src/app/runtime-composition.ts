import * as k8s from "@kubernetes/client-node";
import type { PrismaClient } from "@prisma/client";

import { _CreateArtifactPreprocessAuthority, PrismaArtifactScanUnitOfWork, __CreateArtifactPreprocessControllerRouter, __CreateArtifactPreprocessorRouter, __CreateArtifactScannerRouter } from "@opencrane/backend/server/agents/artifacts";
import { PrismaSkillAuthoringValidationControllerUnitOfWork, PrismaSkillAuthoringValidationWorkerUnitOfWork, __CreateSkillAuthoringValidationControllerRouter, __CreateSkillAuthoringValidationWorkerRouter } from "@opencrane/backend/server/agents/skills";
import { _CreateAgentControllerTokenReviewer, _CreateArtifactPreprocessorTokenReviewer, _CreateArtifactScannerTokenReviewer, _CreateSkillAuthoringValidationTokenReviewer, _ValidateIsolatedWorkloadNamespace } from "@opencrane/backend/server/infra/workload-identity";
import { PrismaConversationAssetScanRepository } from "@opencrane/backend/server/conversation-assets";
import type { IWorkflowEngine } from "@opencrane/backend/server/infra/workflows/contract";

import { _CreateArtifactPreprocessSourceBroker } from "../infra/artifacts/artifact-preprocess-source-broker.factory";
import { _CreateArtifactScanSourceBroker } from "../infra/artifacts/artifact-scan-source-broker.factory";
import { _CreateArtifactPreprocessOutputBroker, _CreateSkillAuthoringArtifactReader } from "../infra/artifacts/artifact-upload.factory";
import { _CreateChannelTargetResolver } from "./channel-target-composition";
import type { InternalRuntimeConfig } from "./config.types";
import { _log } from "./log";
import type { ControllerRuntimeComposition, InternalRuntimeComposition, OptionalRuntimeComposition } from "./runtime-composition.types";

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
 * Bind the AgentRun and skill-validation workflows to one reviewed controller identity.
 *
 * Both routers run in the trusted server namespace. Keeping their repositories together makes the
 * shared claim lease explicit without giving either controller endpoint runtime-stream authority.
 *
 * @param prisma - The main product database client.
 * @param config - Frozen leases and assignment limits.
 * @param serverNamespace - Namespace containing the trusted server identity.
 * @param tokenReviewer - Reviewer fixed to the sole agent-controller ServiceAccount.
 * @returns Controller routers with no runtime or worker routes.
 */
function _CreateControllerRuntimeComposition(prisma: PrismaClient, config: InternalRuntimeConfig, serverNamespace: string, tokenReviewer: ReturnType<typeof _CreateAgentControllerTokenReviewer>): ControllerRuntimeComposition
{
	const authoringNamespace = _ValidateIsolatedWorkloadNamespace(config.skillAuthoringNamespace, serverNamespace);
	return {
		skillAuthoringValidationController: __CreateSkillAuthoringValidationControllerRouter({
			tokenReviewer,
			namespace: serverNamespace,
			authoringNamespace,
			authority: new PrismaSkillAuthoringValidationControllerUnitOfWork(prisma),
			logger: _log,
		}),
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
		conversationReplay: null,
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
				authority: new PrismaArtifactScanUnitOfWork(prisma, config.artifactScannerClaimLeaseMilliseconds, function _ConversationAssets(transaction) { return new PrismaConversationAssetScanRepository(transaction); }, workflowExecution),
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
	// 1. Create reviewers once and pass each only to its matching caller plane; neighbouring routes
	// cannot silently reinterpret a controller, validation worker, or runtime identity.
	const serverNamespace = config.serverNamespace;
	const controllerTokenReviewer = _CreateAgentControllerTokenReviewer(authApi, serverNamespace);
	const skillAuthoringValidationTokenReviewer = _CreateSkillAuthoringValidationTokenReviewer(authApi, config.skillAuthoringNamespace);
	// 2. Compose only named routers; `routes.ts` remains the single readable map of internal paths.
	const skillAuthoringValidationWorker = __CreateSkillAuthoringValidationWorkerRouter({ tokenReviewer: skillAuthoringValidationTokenReviewer, authority: new PrismaSkillAuthoringValidationWorkerUnitOfWork(prisma), artifactReader: _CreateSkillAuthoringArtifactReader(prisma), logger: _log });
	return {
		..._CreateControllerRuntimeComposition(prisma, config, serverNamespace, controllerTokenReviewer),
		skillAuthoringValidationWorker,
		..._CreateOptionalRuntimeComposition(prisma, authApi, config, serverNamespace, controllerTokenReviewer, workflowExecution),
	};
}
