/** Supplies the release-owned values needed to realize one fenced computer generation. */
export interface AgentSandboxClaimCommand
{
	readonly siloId: string;
	readonly computerId: string;
	readonly leaseId: string;
	readonly generation: number;
	readonly namespace: string;
	readonly profileName: string;
	readonly warmPoolName: string;
	readonly expiresAt: string;
	readonly reason: "activation_requested" | "recovery_requested";
}

/** Reports the converged claim identity without treating controller readiness as claim creation. */
export interface AgentSandboxClaimResult
{
	readonly claimId: string;
	readonly outcome: "created" | "existing";
	readonly sandboxId: string | null;
	readonly serviceFQDN: string | null;
}

/** Supplies the exact deterministic claim coordinates that may be released. */
export interface AgentSandboxClaimReleaseCommand
{
	readonly namespace: string;
	readonly claimId: string;
	readonly computerId: string;
	readonly leaseId: string;
	readonly generation: number;
}

/** Supplies the exact deterministic claim coordinates whose shutdown time may move later. */
export interface AgentSandboxClaimRenewCommand extends AgentSandboxClaimReleaseCommand
{
	/** Sets the new ISO shutdown instant that must be later than the current one. */
	readonly expiresAt: string;
}

/**
 * Reports what the controller currently records for one deterministic claim.
 *
 * The lifecycle worker compares these values with canonical KurrentDB lease history to decide
 * whether a realization is still alive, not to grant it any authority.
 */
export interface AgentSandboxClaimStatus
{
	/** Names the deterministic claim that was read. */
	readonly claimId: string;
	/** Identifies the assigned sandbox, or null while the controller is still assigning one. */
	readonly sandboxId: string | null;
	/** Carries the controller-reported Service DNS name after assignment. */
	readonly serviceFQDN: string | null;
	/** Reports the shutdown instant the claim currently carries. */
	readonly shutdownTime: string | null;
}
