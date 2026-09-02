/** Supplies the personal-agent and user coordinates a binding authority must verify before provisioning. */
export interface ProxiedAgentIdentityProvisionCommand
{
	/** Identifies the silo that owns the personal service and its identity. */
	readonly siloId: string;
	/** Identifies the personal AgentService selected by the caller's binding authority. */
	readonly agentServiceId: string;
	/** Identifies the user Principal whose authority the agent may proxy after caller verification. */
	readonly proxiedPrincipalId: string;
	/** Identifies the revision-scoped delegation ceiling selected by the caller. */
	readonly delegationPolicyId: string;
	/** Supplies the personal-agent display name for the first identity snapshot. */
	readonly agentServiceName: string;
}

/** Supplies the trusted server time for an initial proxied identity snapshot. */
export interface ProxiedAgentIdentityProvisionerClock
{
	/** Returns the time recorded if the deterministic identity stream is first created. */
	now(): Date;
}

/** Ensures one active identity for an exact personal service, user principal, and delegation policy. */
export interface ProxiedAgentIdentityProvisioner
{
	/** Creates or reloads the matching active proxied identity after a no-stream append race. */
	ensure(command: ProxiedAgentIdentityProvisionCommand): Promise<{ readonly agentIdentityId: string }>;
}
