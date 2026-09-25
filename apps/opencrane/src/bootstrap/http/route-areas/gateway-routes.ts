import { _CreateMcpCallerResolver, mcpConnectionRouter, mcpOperatorRouter, mcpTaskRouter } from "@opencrane/backend/server/gateways/mcp";
import { modelRoutingDefaultsRouter } from "@opencrane/backend/server/gateways/model-routing";
import { _CreateGlobalModelRoutingDefaultCommandPort, modelRegistryRouter, providerByokRouter } from "@opencrane/backend/server/gateways/providers";
import { PrismaAuthenticatedPrincipalDirectoryUnitOfWork } from "@opencrane/backend/server/iam/identity";

import { _log } from "../../process/log";
import type { ProductRouteDependencies, RouteMount } from "../routes.types";

/**
 * Build the MCP tool, model-routing and provider routes.
 *
 * Four routers share `/api/v1/mcp` and one principal directory. Keep their order: Express tries
 * them in mount order.
 *
 * Called by: `_RegisterRoutes` in routes.ts.
 *
 * @param dependencies - Shared product services; this area uses the tool services and provider effects.
 * @returns The area's routes in mount order.
 */
export function _CreateGatewayRoutes(dependencies: ProductRouteDependencies): readonly RouteMount[]
{
	const { prisma, providerEffects } = dependencies;
	const { workflows, runtime } = dependencies.tools;
	const principalDirectory = new PrismaAuthenticatedPrincipalDirectoryUnitOfWork(prisma);
	const resolveMcpCaller = _CreateMcpCallerResolver(principalDirectory);
	return [
		{ method: "use", path: "/api/v1/mcp", handler: mcpOperatorRouter(workflows.unitOfWork, principalDirectory, workflows.eraProbeWorkflow, workflows.ociImageValidationWorkflow, workflows.ociImageArtifacts, runtime.connections) },
		{ method: "use", path: "/api/v1/mcp", handler: mcpTaskRouter(workflows.unitOfWork, runtime.taskWorkflow, resolveMcpCaller) },
		{ method: "use", path: "/api/v1/mcp", handler: runtime.promotion },
		{ method: "use", path: "/api/v1/mcp", handler: mcpConnectionRouter(runtime.connections, resolveMcpCaller) },
		{ method: "use", path: "/api/v1/model-routing/defaults", handler: modelRoutingDefaultsRouter(prisma, undefined, undefined, _CreateGlobalModelRoutingDefaultCommandPort(prisma, providerEffects)) },
		{ method: "use", path: "/api/v1/providers/byok", handler: providerByokRouter(prisma, providerEffects, _log) },
		{ method: "use", path: "/api/v1/models", handler: modelRegistryRouter(prisma, providerEffects) },
	];
}
