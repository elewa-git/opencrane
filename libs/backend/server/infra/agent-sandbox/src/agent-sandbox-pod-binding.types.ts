import type { ClaimedLeaseScope } from "@opencrane/contracts";
import type { RuntimeWorkloadIdentity } from "@opencrane/backend/server/infra/workload-identity";

/** Lease coordinates that a TokenReviewed Sandbox Pod must exactly match. */
export interface AgentSandboxPodBindingCommand
{
	/** Identifies the current logical computer. */
	readonly computerId: string;
	/** Names the lease, its generation and the SandboxClaim whose labels the Pod must carry. */
	readonly lease: ClaimedLeaseScope;
	/** Carries the identity returned by Kubernetes TokenReview. */
	readonly workload: RuntimeWorkloadIdentity;
}

/** Verifies exact claim and Pod metadata after TokenReview. */
export interface AgentSandboxPodBinding
{
	/** Return true only when the claim and one Pod both bind every current coordinate. */
	verify(command: AgentSandboxPodBindingCommand): Promise<boolean>;
}
