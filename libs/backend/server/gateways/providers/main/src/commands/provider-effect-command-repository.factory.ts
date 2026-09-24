import type { Prisma } from "@prisma/client";

import { PrismaProviderEffectCommandRepository } from "./prisma-provider-effect-command-repository";
import type { ProviderEffectCommandRepository } from "./provider-effect-command.types";

/**
 * Builds the provider-effect repository over the caller's exact protected transaction.
 *
 * Called by: {@link PrismaProviderGatewayUnitOfWork} for retrying and non-retrying operations.
 *
 * @param transaction - Transaction that also owns central authorization and protected intent.
 * @returns Transaction-scoped provider command repository.
 */
export function _CreateProviderEffectCommandRepository(transaction: Prisma.TransactionClient): ProviderEffectCommandRepository
{
	return new PrismaProviderEffectCommandRepository(transaction);
}
