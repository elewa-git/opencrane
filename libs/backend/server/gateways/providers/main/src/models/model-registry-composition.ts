import type { Router } from "express";
import type { Prisma, PrismaClient } from "@prisma/client";

import type { ProviderGatewayAuthorizationFactory, ProviderGatewayCallerResolver } from "../authorization/provider-gateway-authority.types";
import { _ResolveProviderGatewayCaller } from "../authorization/provider-gateway-authorization";
import type { ProviderEffectCommandExecutor } from "../commands/provider-effect-command.types";
import { PrismaModelDefinitionUnitOfWork } from "./prisma-model-definition-service";
import { _CreateModelRegistryRouter } from "./model-registry";

/**
 * Compose the model-registry transport with its transaction and effect owners.
 *
 * Called by: the OpenCrane server route composition and focused transport tests.
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
