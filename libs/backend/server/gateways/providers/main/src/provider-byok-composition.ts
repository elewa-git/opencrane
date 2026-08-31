import type { Router } from "express";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { Logger } from "@opencrane/backend/observability";

import type { ProviderGatewayAuthorizationFactory, ProviderGatewayCallerResolver } from "./provider-gateway-authority.types";
import { _ResolveProviderGatewayCaller } from "./provider-gateway-authorization";
import type { ProviderEffectCommandExecutor } from "./provider-effect-command.types";
import { PrismaProviderGatewayUnitOfWork } from "./prisma-provider-gateway-unit-of-work";
import { _CreateProviderByokRouter } from "./routes/provider-byok";

/**
 * Composes the BYOK transport with its Prisma transaction owner.
 *
 * Called by: apps/opencrane/src/app/routes.ts and focused transport tests.
 *
 * @param prisma - Root client that opens provider authorization transactions.
 * @param effectExecutor - Shared executor that delivers admitted provider commands.
 * @param log - Process-wide logger supplied by the hosting application.
 * @param resolveCaller - Trusted request identity resolver, replaceable in transport tests.
 * @param createAuthorization - Central authority factory, replaceable in transaction tests.
 * @returns Configured BYOK router.
 */
export function providerByokRouter(prisma: PrismaClient, effectExecutor: ProviderEffectCommandExecutor, log: Logger, resolveCaller: ProviderGatewayCallerResolver = _ResolveProviderGatewayCaller, createAuthorization?: ProviderGatewayAuthorizationFactory<Prisma.TransactionClient>): Router
{
	const providers = new PrismaProviderGatewayUnitOfWork(prisma, createAuthorization);
	return _CreateProviderByokRouter(providers, effectExecutor, log, resolveCaller);
}
