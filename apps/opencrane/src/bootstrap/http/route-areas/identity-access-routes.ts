import type { PrismaClient } from "@prisma/client";
import { Router } from "express";

import { auditRouter } from "@opencrane/backend/server/iam/audit";
import { PrismaAuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";
import { _CreateResourceShareCallerResolver, PrismaResourceShareUnitOfWork, ResourceShareService, resourceSharesRouter } from "@opencrane/backend/server/iam/grants";
import { groupsRouter } from "@opencrane/backend/server/iam/groups";
import { PrismaAuthenticatedPrincipalDirectoryUnitOfWork } from "@opencrane/backend/server/iam/identity";
import { _RateLimit } from "@opencrane/backend/server/infra/http";

import type { ResourceSharesRouteOptions, RouteMount } from "../routes.types";

/**
 * Build the audit, group, member and resource-sharing routes.
 *
 * Called by: `_RegisterRoutes` in routes.ts.
 *
 * @param prisma - The main product database client.
 * @param organizationMembers - Startup-selected standalone or Fleet member authority.
 * @returns The area's routes in mount order.
 */
export function _CreateIdentityAndAccessRoutes(prisma: PrismaClient, organizationMembers: Router): readonly RouteMount[]
{
	return [
		{ method: "use", path: "/api/v1/audit", handler: auditRouter(prisma, function _CreateAuditAuthorization(transaction) { return new PrismaAuthorizationAuthority(transaction); }) },
		{ method: "use", path: "/api/v1/groups", handler: groupsRouter(prisma) },
		{ method: "use", path: "/api/v1/organization/members", handler: organizationMembers },
		{ method: "use", path: "/api/v1/resource-shares", handler: _CreateRateLimitedResourceSharesRouter(prisma) },
	];
}

/**
 * Composes resource-share authority behind the shared per-IP limiter before identity or database work.
 *
 * The grants domain stays transport-agnostic; the OpenCrane app owns HTTP abuse protection.
 *
 * Called by: `_CreateIdentityAndAccessRoutes` above for `/api/v1/resource-shares`, and
 * apps/opencrane/src/__tests__/shares-rate-limit.test.ts, which is why the limiter is tunable.
 *
 * @param prisma - The main product database client.
 * @param options - Optional bounded limiter tuning for an isolated application test.
 * @returns The protected sharing router.
 */
export function _CreateRateLimitedResourceSharesRouter(prisma: PrismaClient, options?: ResourceSharesRouteOptions): Router
{
	const router = Router();
	const service = new ResourceShareService(new PrismaResourceShareUnitOfWork(prisma));
	const resolveCaller = _CreateResourceShareCallerResolver(new PrismaAuthenticatedPrincipalDirectoryUnitOfWork(prisma));
	router.use(_RateLimit(options?.rateLimit));
	router.use(resourceSharesRouter(service, resolveCaller));
	return router;
}
