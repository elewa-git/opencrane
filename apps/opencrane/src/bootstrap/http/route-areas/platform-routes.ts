import type { PrismaClient } from "@prisma/client";

import { spec } from "@opencrane/backend/server/api-spec";
import { _OpenapiRouter } from "@opencrane/backend/server/infra/http";
import { thirdPartySourcesRouter } from "@opencrane/backend/server/knowledge/retrieval";
import { aiBudgetRouter, tokenUsageRouter } from "@opencrane/backend/server/reporting/spend";

import type { RouteMount } from "../routes.types";

/**
 * Build the third-party source, spend-reporting and API-description routes.
 *
 * Called by: `_RegisterRoutes` in routes.ts.
 *
 * @param prisma - The main product database client.
 * @returns The area's routes in mount order.
 */
export function _CreatePlatformRoutes(prisma: PrismaClient): readonly RouteMount[]
{
	return [
		{ method: "use", path: "/api/v1/third-party-sources", handler: thirdPartySourcesRouter(prisma) },
		{ method: "use", path: "/api/v1/ai-budget", handler: aiBudgetRouter(prisma) },
		{ method: "use", path: "/api/v1/token-usage", handler: tokenUsageRouter(prisma) },
		{ method: "use", path: "/api/v1/openapi.json", handler: _OpenapiRouter(spec) },
	];
}
