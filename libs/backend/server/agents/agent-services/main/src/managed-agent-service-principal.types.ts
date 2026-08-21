/** Transaction-scoped writer for managed AgentService-owned Principal rows. */
export interface ManagedAgentServicePrincipalRepository
{
	/** Creates the exact internal Principal for a service before the service row is inserted. */
	create(siloId: string, agentServiceId: string, displayName: string, createdAt: Date): Promise<string>;
}
