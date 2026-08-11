import { Router, type Express } from "express";
import type { PrismaClient } from "@prisma/client";
import type * as k8s from "@kubernetes/client-node";

import { aiBudgetRouter, tokenUsageRouter } from "@opencrane/backend/server/reporting/spend";
import { auditRouter } from "@opencrane/backend/server/iam/audit";
import { groupsRouter } from "@opencrane/backend/server/iam/groups";
import { _IssueAttemptLiteLlmKey, modelRoutingDefaultsRouter } from "@opencrane/backend/server/gateways/model-routing";
import { mcpOperatorRouter, mcpServersRouter } from "@opencrane/backend/server/gateways/mcp";
import { _CreateIntegrationCustodyRouter } from "@opencrane/backend/server/gateways/integrations";
import type { ObotCustodyPort } from "@opencrane/backend/server/infra/obot-custody";
import { providerCredentialsRouter, providerByokRouter, modelRegistryRouter } from "@opencrane/backend/server/gateways/providers";
import { resourceSharesRouter, sharesRouter } from "@opencrane/backend/server/iam/grants";
import { thirdPartySourcesRouter } from "@opencrane/backend/server/knowledge/retrieval";
import { spec } from "@opencrane/backend/server/api-spec";
import { _CreateAgentServicesRouter, type ManagedRunAdmissionPort } from "@opencrane/backend/server/agents/agent-services";
import { _CreateElicitationInterruptReader, _CreateSelfElicitationActivityRouter, _CreateSelfElicitationRouter } from "@opencrane/backend/agents/execution/elicitation";
import { _CreatePersonaOnboardingRouter } from "@opencrane/backend/agents/personal/personas";
import { type UserOnboardingOwnerResolver } from "@opencrane/backend/server/agents/onboarding";
import { _CreatePersonalArtifactCatalogueRouter } from "@opencrane/backend/server/agents/artifacts";
import { _CreatePersonalConfigurationRouter } from "@opencrane/backend/agents/personal/configuration";
import { _CreateSelfConversationReplayRouter, _CreateSelfConversationsRouter } from "@opencrane/backend/server/conversations";
import { _CreateConversationAttachmentAdmission, __CreateConversationAssetRouter } from "@opencrane/backend/server/conversation-assets";
import { _CreateSelfRunCancellationRouter, _CreateSelfRunStatusRouter, type RunCancellationRepository } from "@opencrane/backend/agents/execution/runs";
import type { PersonalRunAdmissionPort } from "@opencrane/backend/agents/execution/admission";
import { _CreateSkillCatalogueRouter } from "@opencrane/backend/server/agents/skills";
import { _CreateSteeringIngestRouter } from "@opencrane/backend/agents/execution/protocol";
import { _ResolveRequestPrincipal } from "@opencrane/backend/server/infra/auth";
import { _CheckDbHealth, _OpenapiRouter, _RateLimit } from "@opencrane/backend/server/infra/http";
import type { MemoryGatewayClient } from "@opencrane/backend/server/infra/memory-gateway-client";

import type { InternalRuntimeConfig } from "./config.types.js";
import { _log } from "./log.js";
import { _CreateInternalRuntimeComposition } from "./runtime-composition.js";
import type { RouteMount, SharesRouteOptions } from "./routes.types.js";
import { _CreateUserOnboardingComposition } from "./user-onboarding-composition.js";
import { _ProcessShutdownSignal } from "./process-shutdown.js";
import { ___CreateDbHealthProbe } from "../infra/db/db.js";
import { _CreateConversationAssetAuthority } from "../infra/artifacts/artifact-upload.factory.js";

/**
 * Register the authenticated product API from functional route lists.
 *
 * @param app - Public Express listener, already protected by browser-session authentication.
 * @param prisma - The main product database client.
 * @param coreApi - Kubernetes client used only by the provider bring-your-own-key capability.
 * @param runAdmission - Shared managed run-now and scheduler admission port.
 * @param personalRunAdmission - Shared personal browser-run admission port.
 * @param runCancellation - Shared attempt-fenced cancellation authority.
 * @param serverNamespace - Namespace in which provider Secrets are managed.
 * @param obotCustody - Composed Obot custody authority (fail-closed adapter when Obot is off).
 * @param artifactScannerEnabled - Whether upload admission has a live scanner consumer.
 * @returns The configured public listener.
 */
export function _RegisterRoutes(app: Express, prisma: PrismaClient, coreApi: k8s.CoreV1Api, runAdmission: ManagedRunAdmissionPort, personalRunAdmission: PersonalRunAdmissionPort, runCancellation: RunCancellationRepository, serverNamespace: string, obotCustody: ObotCustodyPort, artifactScannerEnabled: boolean): Express
{
	const onboarding = _CreateUserOnboardingComposition(prisma, _log, _ResolveUserOnboardingOwner);
	const identityAndAccessRoutes: readonly RouteMount[] = [
		{ method: "use", path: "/api/v1/audit", handler: auditRouter(prisma) },
		{ method: "use", path: "/api/v1/groups", handler: groupsRouter(prisma) },
		{ method: "use", path: "/api/v1/shares", handler: _CreateRateLimitedSharesRouter(prisma) },
		{ method: "use", path: "/api/v1/resource-shares", handler: resourceSharesRouter(prisma) },
	];
	const agentRoutes: readonly RouteMount[] = [
		{ method: "use", path: "/api/v1/agent-services", handler: _CreateAgentServicesRouter(prisma, runAdmission, _log) },
		{ method: "use", path: "/api/v1/skills", handler: _CreateSkillCatalogueRouter(prisma, _log) },
	];
	const personalWorkspaceRoutes: readonly RouteMount[] = [
		{ method: "use", path: "/api/v1/me/onboarding", handler: onboarding.router },
		{ method: "use", path: "/api/v1/me/assets", handler: _CreatePersonalArtifactCatalogueRouter(prisma, _log) },
		{ method: "use", path: "/api/v1/me/persona", handler: _CreatePersonaOnboardingRouter(prisma, _log, onboarding.personaWorkflow) },
		{ method: "use", path: "/api/v1/me/runs", handler: _CreateSteeringIngestRouter(prisma, _log) },
		{ method: "use", path: "/api/v1/me/runs", handler: _CreateSelfRunStatusRouter(prisma, _log) },
		{ method: "use", path: "/api/v1/me/runs", handler: _CreateSelfRunCancellationRouter(prisma, runCancellation, _log) },
		{ method: "use", path: "/api/v1/me/configuration", handler: _CreatePersonalConfigurationRouter(prisma, _log) },
		{ method: "use", path: "/api/v1/me/conversations", handler: _CreateSelfConversationsRouter(prisma, personalRunAdmission, _CreateConversationAttachmentAdmission, _log) },
		{ method: "use", path: "/api/v1/me/conversations", handler: __CreateConversationAssetRouter({ resolveCaller: _ResolveConversationAssetCaller, authority: _CreateConversationAssetAuthority(prisma, process.env, artifactScannerEnabled), logger: _log }) },
		{ method: "use", path: "/api/v1/me/conversations", handler: _CreateSelfElicitationRouter(prisma, _log) },
		{ method: "use", path: "/api/v1/me/conversations", handler: _CreateSelfConversationReplayRouter(prisma, _log, { interrupts: _CreateElicitationInterruptReader(prisma), shutdownSignal: _ProcessShutdownSignal }) },
		{ method: "use", path: "/api/v1/me/activity", handler: _CreateSelfElicitationActivityRouter(prisma, _log) },
	];
	const gatewayRoutes: readonly RouteMount[] = [
		{ method: "use", path: "/api/v1/mcp-servers", handler: mcpServersRouter(prisma) },
		{ method: "use", path: "/api/v1/mcp", handler: mcpOperatorRouter(prisma) },
		{ method: "use", path: "/api/v1/integrations", handler: _CreateIntegrationCustodyRouter(prisma, obotCustody, _log) },
		{ method: "use", path: "/api/v1/model-routing/defaults", handler: modelRoutingDefaultsRouter(prisma) },
		{ method: "use", path: "/api/v1/providers/credentials", handler: providerCredentialsRouter(prisma) },
		{ method: "use", path: "/api/v1/providers/byok", handler: providerByokRouter(prisma, coreApi, serverNamespace) },
		{ method: "use", path: "/api/v1/models", handler: modelRegistryRouter(prisma) },
	];
	const knowledgeRoutes: readonly RouteMount[] = [
		{ method: "use", path: "/api/v1/third-party-sources", handler: thirdPartySourcesRouter(prisma) },
	];
	const reportingRoutes: readonly RouteMount[] = [
		{ method: "use", path: "/api/v1/ai-budget", handler: aiBudgetRouter(prisma) },
		{ method: "use", path: "/api/v1/token-usage", handler: tokenUsageRouter(prisma) },
	];
	const infrastructureRoutes: readonly RouteMount[] = [
		{ method: "use", path: "/api/v1/openapi.json", handler: _OpenapiRouter(spec) },
		{ method: "get", path: "/healthz", handler: _CheckDbHealth(___CreateDbHealthProbe(prisma)) },
	];
	_MountRouteAreas(app, [
		identityAndAccessRoutes,
		agentRoutes,
		personalWorkspaceRoutes,
		gatewayRoutes,
		knowledgeRoutes,
		reportingRoutes,
		infrastructureRoutes,
	]);
	return app;
}

/** Resolve the onboarding owner only from the authenticated user on the request, never from the request body. */
const _ResolveUserOnboardingOwner: UserOnboardingOwnerResolver = function _Owner(request)
{
	const principal = _ResolveRequestPrincipal(request);
	return principal === null ? null : { siloId: principal.siloId, subjectId: principal.subjectId };
};

/** Resolve conversation-file authority only from the verified browser principal. */
const _ResolveConversationAssetCaller = function _ConversationAssetCaller(request: Parameters<typeof _ResolveRequestPrincipal>[0])
{
	const principal = _ResolveRequestPrincipal(request);
	return principal === null ? null : { siloId: principal.siloId, subjectId: principal.subjectId };
};

/**
 * Composes the share authority behind the shared per-IP limiter before identity or database work.
 *
 * The grants domain stays transport-agnostic; the OpenCrane app owns HTTP abuse protection.
 *
 * @param prisma - The main product database client.
 * @param options - Optional bounded limiter tuning for an isolated application test.
 * @returns The protected sharing router.
 */
export function _CreateRateLimitedSharesRouter(prisma: PrismaClient, options?: SharesRouteOptions): Router
{
	const router = Router();
	router.use(_RateLimit(options?.rateLimit));
	router.use(sharesRouter(prisma));
	return router;
}

/**
 * Register the workload-facing API from explicit controller, runtime, worker, and replay lists.
 *
 * @param app - Internal Express listener, unreachable from the public ingress.
 * @param prisma - The main product database client.
 * @param authApi - Kubernetes TokenReview client for workload identity.
 * @param config - Frozen workload-facing configuration shared with workers and body parsing.
 * @param memoryGateway - Process-wide authenticated memory-gateway client.
 */
export function _RegisterInternalRoutes(app: Express, prisma: PrismaClient, authApi: k8s.AuthenticationV1Api, config: InternalRuntimeConfig, memoryGateway: MemoryGatewayClient): void
{
	const runtime = _CreateInternalRuntimeComposition(prisma, authApi, config, memoryGateway);
	const internalControllerRoutes: readonly RouteMount[] = [
		{ method: "use", path: "/api/internal/agent-controller", handler: runtime.agentControllerRunDispatch },
		{ method: "use", path: "/api/internal/agent-controller", handler: runtime.skillWorkloadDispatch },
	];
	const internalRuntimeRoutes: readonly RouteMount[] = [
		{ method: "use", path: "/api/internal/agent-runtime", handler: runtime.skillWorkloadBootstrap },
		{ method: "use", path: "/api/internal/agent-runtime", handler: runtime.skillAuthoringInput },
		{ method: "use", path: "/api/internal/agent-runtime", handler: runtime.skillAuthoringCompletion },
		{ method: "use", path: "/api/internal/agent-runtime", handler: runtime.runtimeBootstrap },
		{ method: "use", path: "/api/internal/agent-runtime", handler: runtime.runtimeStream },
		{ method: "use", path: "/api/internal/agent-runtime", handler: runtime.conversationAssetOutputs },
	];
	const internalWorkerRoutes = _OptionalRoute("/api/internal/artifact-preprocessor", runtime.artifactPreprocessor);
	const internalScannerRoutes = _OptionalRoute("/api/internal/artifact-scanner", runtime.artifactScanner);
	const internalChannelTargetRoutes = _OptionalRoute("/api/internal/channel-targets:resolve", runtime.channelTargetResolver);
	const internalReplayRoutes = _OptionalRoute("/api/internal/conversation-replay", runtime.conversationReplay);
	_MountRouteAreas(app, [internalControllerRoutes, internalRuntimeRoutes, internalWorkerRoutes, internalScannerRoutes, internalChannelTargetRoutes, internalReplayRoutes]);
}

/** Return a one-entry route list for a router, or an empty list when the router is null. */
function _OptionalRoute(path: string, handler: Router | null): readonly RouteMount[]
{
	return handler === null ? [] : [{ method: "use", path, handler }];
}

/** Mount route areas in declaration order so neighbouring routers can intentionally share a path. */
function _MountRouteAreas(app: Express, areas: readonly (readonly RouteMount[])[]): void
{
	for (const area of areas)
	{
		for (const route of area)
		{
			if (route.method === "get") app.get(route.path, route.handler);
			else app.use(route.path, route.handler);
		}
	}
}
