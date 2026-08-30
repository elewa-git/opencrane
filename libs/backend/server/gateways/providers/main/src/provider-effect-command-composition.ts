import type * as k8s from "@kubernetes/client-node";
import type { PrismaClient } from "@prisma/client";

import { DefaultProviderEffectCommandExecutor } from "./provider-effect-command-executor";
import { DefaultProviderEffectCommandHandler } from "./provider-effect-command-handler";
import type { ProviderEffectCommandExecutor } from "./provider-effect-command.types";
import { PrismaProviderEffectCommandUnitOfWork } from "./prisma-provider-effect-command-unit-of-work";

/** Trusted control-plane profile allowed to claim durable provider-effect commands. */
export const _PROVIDER_EFFECT_EXECUTOR_PROFILE = "opencrane-control-plane/provider-effect-v1";

/**
 * Composes the post-commit provider executor used by HTTP routes.
 *
 * Called by: `providerByokRouter` and `modelRegistryRouter` when tests or another composition root
 * do not supply an executor.
 *
 * @param prisma - Product database for command delivery and provider projections.
 * @param coreApi - Kubernetes custody adapter required by BYOK commands, or null for model-only use.
 * @param operatorNamespace - Namespace containing fixed BYOK Secrets, or null for model-only use.
 * @returns Executor that fences database work around, but never across, an external call.
 */
export function _CreateProviderEffectCommandExecutor(prisma: PrismaClient, coreApi: k8s.CoreV1Api | null = null, operatorNamespace: string | null = null): ProviderEffectCommandExecutor
{
	const unitOfWork = new PrismaProviderEffectCommandUnitOfWork(prisma);
	const handler = new DefaultProviderEffectCommandHandler(prisma, coreApi, operatorNamespace);
	return new DefaultProviderEffectCommandExecutor(unitOfWork, handler, _PROVIDER_EFFECT_EXECUTOR_PROFILE);
}
