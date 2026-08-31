import type { Router } from "express";
import type { Prisma, PrismaClient } from "@prisma/client";

import type { ProviderGatewayAuthorizationFactory, ProviderGatewayCallerResolver } from "./provider-gateway-authority.types";
import { _ResolveProviderGatewayCaller } from "./provider-gateway-authorization";
import type { ProviderEffectCommandExecutor } from "./provider-effect-command.types";
import { PrismaModelDefinitionUnitOfWork } from "./prisma-model-definition-service";
import { _CreateModelRegistryRouter } from "./routes/model-registry";

/**
 * Compose the model-registry transport with its transaction and effect owners.
 *
 * Called by: apps/opencrane/src/app/routes.ts and focused transport tests.
 *
 * @param prisma - Prisma client that opens model-definition authorization transactions.
 * @param effectExecutor - Post-commit executor for durable LiteLLM registration commands.
 * @param resolveCaller - Request identity resolver, injectable for focused transport tests.
 * @param createAuthorization - Central authority factory, injectable for focused tests.
 * @returns Configured model-registry router.
 */
export function modelRegistryRouter(prisma: PrismaClient, effectExecutor: ProviderEffectCommandExecutor, resolveCaller: ProviderGatewayCallerResolver = _ResolveProviderGatewayCaller, createAuthorization?: ProviderGatewayAuthorizationFactory<Prisma.TransactionClient>): Router
{
	const models = new PrismaModelDefinitionUnitOfWork(prisma, effectExecutor, createAuthorization);
	return _CreateModelRegistryRouter(models, resolveCaller);
}
