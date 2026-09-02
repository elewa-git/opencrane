/** Carries the verified managed-service facts required to ensure its durable AgentIdentity. */
export interface ManagedAgentIdentityProvisionCommand
{
	/** Identifies the silo that owns the managed service and its identity stream. */
	readonly siloId: string;
	/** Identifies the managed AgentService that deterministically owns the identity. */
	readonly agentServiceId: string;
	/** Identifies the managed service's already-verified dedicated Principal. */
	readonly principalId: string;
	/** Supplies the trusted service display name captured for the first identity snapshot. */
	readonly agentServiceName: string;
}

/** Gives the provisioner a testable server clock for immutable revision-zero timestamps. */
export interface ManagedAgentIdentityProvisionerClock
{
	/** Returns the time recorded when this authority first creates an identity snapshot. */
	now(): Date;
}

/** Returns the deterministic identity coordinate only after its active managed history is checked. */
export interface ManagedAgentIdentityProvisioner
{
	/** Ensures the exact managed identity stream exists and returns its trusted identity id. */
	ensure(command: ManagedAgentIdentityProvisionCommand): Promise<{ readonly agentIdentityId: string }>;
}
