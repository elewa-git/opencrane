import type { RuntimeWorkloadIdentity } from "@opencrane/backend/server/infra/workload-identity";

/** Lease coordinates that a TokenReviewed Sandbox Pod must exactly match. */
export interface AgentSandboxPodBindingCommand
{
	/** Identifies the current logical computer. */
	readonly computerId: string;
	/** Fences the current realization. */
	readonly generation: number;
	/** Identifies the current computer lease. */
	readonly leaseId: string;
	/** Identifies the deterministic claim owned by the lease. */
	readonly sandboxClaimId: string;
	/** Carries the identity returned by Kubernetes TokenReview. */
	readonly workload: RuntimeWorkloadIdentity;
}

/** Verifies exact claim and Pod metadata after TokenReview. */
export interface AgentSandboxPodBinding
{
	/** Return true only when the claim and one Pod both bind every current coordinate. */
	verify(command: AgentSandboxPodBindingCommand): Promise<boolean>;
}
