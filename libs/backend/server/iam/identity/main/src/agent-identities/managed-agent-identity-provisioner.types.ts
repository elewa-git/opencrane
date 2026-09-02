/**
 * Supplies the managed-service facts needed to establish its AgentIdentity history.
 *
 * The provisioner intentionally does not read AgentService persistence: its caller must first
 * verify this service, its dedicated Principal, and its silo. It uses this tuple to select a
 * deterministic stream, then rejects a stream whose active snapshot realizes anything else.
 * @see ManagedAgentIdentityProvisioner for the checked creation or reuse outcome.
 */
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

/**
 * Supplies the server time used for an immutable revision-zero identity snapshot.
 *
 * The clock is read only when a missing stream is first appended; reused streams retain their
 * recorded timestamp, so callers can make first-creation time deterministic in tests.
 */
export interface ManagedAgentIdentityProvisionerClock
{
	/** Returns the time recorded when this authority first creates an identity snapshot. */
	now(): Date;
}

/**
 * Ensures that one managed service has exactly one active, matching AgentIdentity stream.
 *
 * Implementations may create the revision-zero stream or accept another creator's winning append,
 * but they must return only after loading and checking the active snapshot against the supplied
 * service, silo, and Principal. A conflict, inactive identity, or different identity kind is a
 * failure rather than an alternate identity selection.
 */
export interface ManagedAgentIdentityProvisioner
{
	/**
	 * Creates or reuses the deterministic identity stream for verified service facts.
	 *
	 * @param command - Supplies the trusted service coordinates that must match the active snapshot.
	 * @returns The identity id after the matching active history has been checked.
	 * @throws {Error} When the command is incomplete or the stream is absent, inactive, or bound to
	 * another identity realization after creation or an append race.
	 */
	ensure(command: ManagedAgentIdentityProvisionCommand): Promise<{ readonly agentIdentityId: string }>;
}
