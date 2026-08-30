import type * as k8s from "@kubernetes/client-node";
import type { PrismaClient } from "@prisma/client";
import type { Logger } from "@opencrane/backend/observability";

import { DefaultProviderEffectCommandExecutor } from "./provider-effect-command-executor";
import { DefaultProviderEffectCommandHandler } from "./provider-effect-command-handler";
import type { ProviderEffectCommandExecutor } from "./provider-effect-command.types";
import { PrismaProviderEffectCommandUnitOfWork } from "./prisma-provider-effect-command-unit-of-work";
import { PrismaProviderGatewayUnitOfWork } from "./prisma-provider-gateway-unit-of-work";
import { DefaultGlobalModelRoutingDefaultCommandPort } from "./global-model-routing-default-command";
import type { GlobalModelRoutingDefaultCommandPort } from "@opencrane/backend/server/gateways/model-routing";

/** Trusted control-plane profile allowed to claim durable provider-effect commands. */
export const _PROVIDER_EFFECT_EXECUTOR_PROFILE = "opencrane-control-plane/provider-effect-v1";

/**
 * Composes the single post-commit provider executor shared by routes and reconciliation.
 *
 * Called by: the OpenCrane application root before it mounts routes or starts background workers.
 *
 * @param prisma - Product database for command delivery and provider projections.
 * @param coreApi - Kubernetes custody adapter required by BYOK commands, or null for model-only use.
 * @param operatorNamespace - Namespace containing fixed BYOK Secrets, or null for model-only use.
 * @param log - Process-wide logger shared with the hosting application.
 * @returns Executor that fences database work around, but never across, an external call.
 */
export function _CreateProviderEffectCommandExecutor(prisma: PrismaClient, coreApi: k8s.CoreV1Api | null, operatorNamespace: string | null, log: Logger): ProviderEffectCommandExecutor
{
	const unitOfWork = new PrismaProviderEffectCommandUnitOfWork(prisma);
	const handler = new DefaultProviderEffectCommandHandler(coreApi, operatorNamespace, log);
	return new DefaultProviderEffectCommandExecutor(unitOfWork, handler, _PROVIDER_EFFECT_EXECUTOR_PROFILE, log);
}

/** Composes Global routing selection with the same provider executor used by BYOK routes. */
export function _CreateGlobalModelRoutingDefaultCommandPort(prisma: PrismaClient, executor: ProviderEffectCommandExecutor): GlobalModelRoutingDefaultCommandPort
{
	return new DefaultGlobalModelRoutingDefaultCommandPort(new PrismaProviderGatewayUnitOfWork(prisma), executor);
}
