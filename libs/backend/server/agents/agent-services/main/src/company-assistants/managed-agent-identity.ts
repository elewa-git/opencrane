import { createHash } from "node:crypto";

/**
 * Names the stable Kurrent identity owned by one explicitly provisioned managed service.
 * The identity is shared across that service's conversations; child creation never mints a Principal.
 * Called by: managed assistant provisioning and PrismaManagedAgentConversationResolver.
 * @see ManagedAgentConversationCandidate
 */
export function __ManagedAgentIdentityId(agentServiceId: string): string
{
	if (agentServiceId.trim() !== agentServiceId || agentServiceId.length === 0 || agentServiceId.length > 200)
		throw new Error("Managed identity requires a bounded service identifier");
	return `managed-${agentServiceId}`;
}

/**
 * Names the single company assistant an administrator may explicitly provision for a silo.
 * Called by: managed provisioning and its authorized discovery resolver.
 * @see __ManagedAgentIdentityId
 */
export function __CompanyAssistantServiceId(siloId: string): string
{
	if (siloId.trim() !== siloId || siloId.length === 0 || siloId.length > 200)
		throw new Error("Company assistant requires a bounded silo identifier");
	return `company-${createHash("sha256").update(siloId).digest("hex").slice(0, 32)}`;
}
