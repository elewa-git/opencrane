import { PrincipalProvenance, type Prisma } from "@prisma/client";

import type { ManagedAgentServicePrincipalRepository } from "../managed-agent-service-principal.types";
import { __ManagedAgentServicePrincipal, MANAGED_AGENT_SERVICE_PRINCIPAL_ISSUER } from "../managed-agent-service-principal";

/** Persists the internal Principal owned by one managed AgentService transaction. */
export class PrismaManagedAgentServicePrincipalRepository implements ManagedAgentServicePrincipalRepository
{
	/** Transaction that will also create the owning service. */
	private readonly transaction: Prisma.TransactionClient;

	/** Creates the repository inside the service lifecycle transaction. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/** Creates and returns the deterministic internal Principal id. */
	async create(siloId: string, agentServiceId: string, displayName: string, createdAt: Date): Promise<string>
	{
		const principalId = __ManagedAgentServicePrincipal(agentServiceId);
		await this.transaction.principal.create({ data: { id: principalId, siloId, issuer: MANAGED_AGENT_SERVICE_PRINCIPAL_ISSUER, subject: agentServiceId, provenance: PrincipalProvenance.Internal, displayName, createdAt, updatedAt: createdAt } });
		return principalId;
	}
}
