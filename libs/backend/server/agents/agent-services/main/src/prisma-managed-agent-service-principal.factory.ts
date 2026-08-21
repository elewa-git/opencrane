import type { Prisma } from "@prisma/client";

import { PrismaManagedAgentServicePrincipalRepository } from "./prisma-managed-agent-service-principal-repository";

/** Creates the managed-service Principal repository on the lifecycle transaction that owns the service write. */
export function __CreateManagedAgentServicePrincipalRepository(transaction: Prisma.TransactionClient): PrismaManagedAgentServicePrincipalRepository
{
	return new PrismaManagedAgentServicePrincipalRepository(transaction);
}
