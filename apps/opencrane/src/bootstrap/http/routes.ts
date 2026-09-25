import type { Express, Router } from "express";

import { _CreateInternalRuntimeComposition } from "../process/runtime-composition";
import { _CreateAgentRoutes } from "./route-areas/agent-routes";
import { _CreateConversationRoutes } from "./route-areas/conversation-routes";
import { _CreateGatewayRoutes } from "./route-areas/gateway-routes";
import { _CreateIdentityAndAccessRoutes } from "./route-areas/identity-access-routes";
import { _CreatePersonalWorkspaceRoutes } from "./route-areas/personal-workspace-routes";
import { _CreatePlatformRoutes } from "./route-areas/platform-routes";
import type { InternalRouteDependencies, ProductRouteDependencies, RouteMount } from "./routes.types";

/**
 * Register the authenticated product API from functional route areas.
 *
 * Each area builds the services its routers share and returns its routes in mount order. The public
 * health route is mounted before authentication by public-app.ts. Every route here needs the browser
 * session, except the static API description.
 *
 * Called by: public-app.ts, after it has mounted the session middleware and `___AuthMiddleware`.
 *
 * @param app - Public Express listener, already protected by browser-session authentication.
 * @param organizationMembers - Startup-selected standalone or Fleet member authority.
 * @param dependencies - Long-lived services shared by the product routes.
 * @returns The configured public listener.
 */
export function _RegisterRoutes(app: Express, organizationMembers: Router, dependencies: ProductRouteDependencies): Express
{
	_MountRouteAreas(app, [
		_CreateIdentityAndAccessRoutes(dependencies.prisma, organizationMembers),
		_CreateAgentRoutes(dependencies),
		_CreatePersonalWorkspaceRoutes(dependencies),
		_CreateConversationRoutes(dependencies),
		_CreateGatewayRoutes(dependencies),
		_CreatePlatformRoutes(dependencies.prisma),
	]);
	return app;
}

/**
 * Register the workload-facing API from explicit controller, authoring, and worker lists.
 *
 * None of these routes sits behind the browser-session guard, because none of their callers is a
 * browser. Each one authorises the bearer token on the request itself: the controller, authoring, and
 * worker routers put it through Kubernetes TokenReview and accept only a ServiceAccount from the
 * namespace their reviewer was built for. Being on the internal listener is not the protection — a
 * router mounted here without its own check would be open to every workload in the cluster.
 *
 * Skill-authoring validation workers use the `/api/internal/skill-authoring` base path.
 *
 * Called by: internal-app.ts, which builds the workload-facing Express listener.
 *
 * @param app - Internal Express listener, unreachable from the public ingress.
 * @param dependencies - Long-lived services shared by the workload-facing routes.
 */
export function _RegisterInternalRoutes(app: Express, dependencies: InternalRouteDependencies): void
{
	const { prisma, authApi, config, mcpRuntime, generatedFiles, workflowExecution } = dependencies;
	const runtime = _CreateInternalRuntimeComposition(prisma, authApi, config, generatedFiles, workflowExecution);
	const internalControllerRoutes: readonly RouteMount[] = [
		{ method: "use", path: "/api/internal/agent-controller", handler: runtime.skillAuthoringValidationController },
		{ method: "use", path: "/api/internal/agent-controller", handler: mcpRuntime.controller },
		..._OptionalRoute("/api/internal/agent-controller", runtime.artifactPreprocessController),
	];
	const internalMcpExecutorRoutes: readonly RouteMount[] = [
		{ method: "use", path: "/api/internal/mcp-executor", handler: mcpRuntime.companion },
	];
	const internalRuntimeRoutes: readonly RouteMount[] = [
		{ method: "use", path: "/api/internal/skill-authoring", handler: runtime.skillAuthoringValidationWorker },
	];
	const internalWorkerRoutes = _OptionalRoute("/api/internal/artifact-preprocessor", runtime.artifactPreprocessor);
	const internalScannerRoutes = _OptionalRoute("/api/internal/artifact-scanner", runtime.artifactScanner);
	_MountRouteAreas(app, [internalControllerRoutes, internalRuntimeRoutes, internalMcpExecutorRoutes, internalWorkerRoutes, internalScannerRoutes]);
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
			if (route.method === "get")
				app.get(route.path, route.handler);
			else app.use(route.path, route.handler);
		}
	}
}
