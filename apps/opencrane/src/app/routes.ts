import type { Express, Router } from "express";
import type { PrismaClient } from "@prisma/client";
import type * as k8s from "@kubernetes/client-node";

import { aiBudgetRouter, tokenUsageRouter } from "@opencrane/backend/server/reporting/spend";
import { auditRouter } from "@opencrane/backend/server/iam/audit";
import { groupsRouter } from "@opencrane/backend/server/iam/groups";
import { _IssueAttemptLiteLlmKey, modelRoutingDefaultsRouter } from "@opencrane/backend/server/gateways/model-routing";
import { mcpOperatorRouter, mcpServersRouter } from "@opencrane/backend/server/gateways/mcp";
import { providerCredentialsRouter, providerByokRouter, modelRegistryRouter } from "@opencrane/backend/server/gateways/providers";
import { resourceSharesRouter, sharesRouter } from "@opencrane/backend/server/iam/grants";
import { thirdPartySourcesRouter } from "@opencrane/backend/server/knowledge/retrieval";
import { spec } from "@opencrane/backend/server/api-spec";
import { _CreateAgentServicesRouter, type ManagedRunAdmissionPort } from "@opencrane/backend/server/agents/agent-services";
import { _CreateDeferredToolApprovalRouter } from "@opencrane/backend/server/iam/authorization";
import { _CreatePersonaOnboardingRouter } from "@opencrane/backend/agents/personal/personas";
import { _CreatePersonalArtifactCatalogueRouter } from "@opencrane/backend/server/agents/artifacts";
import { _CreatePersonalConfigurationRouter } from "@opencrane/backend/agents/personal/configuration";
import { _CreateSelfConversationReplayRouter } from "@opencrane/backend/server/agents/conversation-replay";
import { _CreateSelfRunStatusRouter } from "@opencrane/backend/agents/execution/runs";
import { _CreateSkillCatalogueRouter } from "@opencrane/backend/server/agents/skills";
import { _CreateSteeringIngestRouter } from "@opencrane/backend/agents/execution/protocol";
import { _CheckDbHealth, _OpenapiRouter } from "@opencrane/backend/_server/http";
import type { MemoryGatewayClient } from "@opencrane/backend/_server/memory-gateway-client";

import type { InternalRuntimeConfig } from "./config.types.js";
import { _log } from "./log.js";
import { _CreateInternalRuntimeComposition } from "./runtime-composition.js";
import type { RouteMount } from "./routes.types.js";

/**
 * Register the authenticated product API from functional route lists.
 *
 * @param app - Public Express listener, already protected by browser-session authentication.
 * @param prisma - Canonical product-authority database client.
 * @param coreApi - Kubernetes client used only by the provider bring-your-own-key capability.
 * @param runAdmission - Shared managed run-now and scheduler admission port.
 * @param serverNamespace - Namespace in which provider Secrets are managed.
 * @returns The configured public listener.
 */
export function _RegisterRoutes(app: Express, prisma: PrismaClient, coreApi: k8s.CoreV1Api, runAdmission: ManagedRunAdmissionPort, serverNamespace: string): Express
{
	const identityAndAccessRoutes: readonly RouteMount[] = [
		{ method: "use", path: "/api/v1/audit", handler: auditRouter(prisma) },
		{ method: "use", path: "/api/v1/groups", handler: groupsRouter(prisma) },
		{ method: "use", path: "/api/v1/shares", handler: sharesRouter(prisma) },
		{ method: "use", path: "/api/v1/resource-shares", handler: resourceSharesRouter(prisma) },
	];
	const agentRoutes: readonly RouteMount[] = [
		{ method: "use", path: "/api/v1/agent-services", handler: _CreateAgentServicesRouter(prisma, runAdmission, _log) },
		{ method: "use", path: "/api/v1/skills", handler: _CreateSkillCatalogueRouter(prisma, _log) },
	];
	const personalWorkspaceRoutes: readonly RouteMount[] = [
		{ method: "use", path: "/api/v1/me/assets", handler: _CreatePersonalArtifactCatalogueRouter(prisma, _log) },
		{ method: "use", path: "/api/v1/me/persona", handler: _CreatePersonaOnboardingRouter(prisma, _log) },
		{ method: "use", path: "/api/v1/me/approvals", handler: _CreateDeferredToolApprovalRouter(prisma, _log) },
		{ method: "use", path: "/api/v1/me/runs", handler: _CreateSteeringIngestRouter(prisma, _log) },
		{ method: "use", path: "/api/v1/me/runs", handler: _CreateSelfRunStatusRouter(prisma, _log) },
		{ method: "use", path: "/api/v1/me/configuration", handler: _CreatePersonalConfigurationRouter(prisma, _log) },
		{ method: "use", path: "/api/v1/me/conversations", handler: _CreateSelfConversationReplayRouter(prisma, _log) },
	];
	const gatewayRoutes: readonly RouteMount[] = [
		{ method: "use", path: "/api/v1/mcp-servers", handler: mcpServersRouter(prisma) },
		{ method: "use", path: "/api/v1/mcp", handler: mcpOperatorRouter(prisma) },
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
		{ method: "get", path: "/healthz", handler: _CheckDbHealth(prisma) },
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

/**
 * Register the workload-facing API from explicit controller, runtime, worker, and replay lists.
 *
 * @param app - Internal Express listener, unreachable from the public ingress.
 * @param prisma - Canonical product-authority database client.
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
	];
	const internalWorkerRoutes = _OptionalRoute("/api/internal/artifact-preprocessor", runtime.artifactPreprocessor);
	const internalReplayRoutes = _OptionalRoute("/api/internal/conversation-replay", runtime.conversationReplay);
	_MountRouteAreas(app, [internalControllerRoutes, internalRuntimeRoutes, internalWorkerRoutes, internalReplayRoutes]);
}

/** Convert an optional capability router into a zero-or-one entry route list. */
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
