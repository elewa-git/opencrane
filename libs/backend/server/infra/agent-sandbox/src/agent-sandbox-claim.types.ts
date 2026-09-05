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
