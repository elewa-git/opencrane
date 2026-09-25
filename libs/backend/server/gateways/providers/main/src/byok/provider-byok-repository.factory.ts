import type { Prisma } from "@prisma/client";

import { PrismaProviderByokRepository } from "./prisma-provider-byok-repository";
import type { ProviderByokRepository } from "./provider-byok-repository.types";

/**
 * Builds provider status and retirement planning over the caller's protected transaction.
 *
 * Called by: {@link PrismaProviderGatewayUnitOfWork} for retrying and non-retrying operations.
 *
 * @param transaction - Transaction that owns the current authorization decision and retirement plan.
 * @returns Transaction-scoped provider BYOK repository.
 */
export function _CreateProviderByokRepository(transaction: Prisma.TransactionClient): ProviderByokRepository
{
	return new PrismaProviderByokRepository(transaction);
}
