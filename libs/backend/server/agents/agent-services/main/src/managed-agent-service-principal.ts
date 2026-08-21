/** Issuer reserved for non-human Principal rows owned by managed AgentService lifecycle. */
export const MANAGED_AGENT_SERVICE_PRINCIPAL_ISSUER = "urn:opencrane:agent-service";

/**
 * Derives the durable Principal primary key owned by one managed AgentService.
 *
 * Called by: managed-service creation and managed-run evidence loading. Both paths must agree on
 * the same coordinate so a caller-supplied service subject can never select a different Principal.
 *
 * @param agentServiceId - Stable managed AgentService identifier.
 * @returns Deterministic local Principal identifier.
 */
export function __ManagedAgentServicePrincipal(agentServiceId: string): string
{
	return `agent-service:${agentServiceId}`;
}
