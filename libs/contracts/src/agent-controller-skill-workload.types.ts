/** One database-fenced governed skill workload claim exposed only to the agent controller. */
export interface AgentControllerSkillWorkloadClaim
{
	/** Durable workload record identifier. */
	readonly workloadId: string;
	/** Silo owning the immutable SkillRevision. */
	readonly siloId: string;
	/** Isolated authoring or tool-runner Job class. */
	readonly kind: "authoring" | "tool-runner";
	/** Immutable revision selected by the skill-work authority. */
	readonly skillRevisionId: string;
	/** Exact database claim instant. */
	readonly claimedAt: string;
	/** Monotonic generation that fences stale controller replicas. */
	readonly deliveryCount: number;
	/** Database-derived instant after which this claim is invalid. */
	readonly expiresAt: string;
}

/** Exact suspended Job evidence submitted for one governed skill workload claim. */
export interface AgentControllerSkillWorkloadAssignmentCommand
{
	/** Exact claim instant returned by the authority. */
	readonly claimedAt: string;
	/** Exact claim generation returned by the authority. */
	readonly deliveryCount: number;
	/** Immutable Kubernetes UID of the controller-created suspended Job. */
	readonly workloadUid: string;
	/** Opaque stable reference projected into the Job and stored only as a database hash. */
	readonly bootstrapReference: string;
	/** Deployment-owned namespace selected by the controller's reviewed workload profile. */
	readonly namespace: string;
}

/** Successful or exact-idempotent governed skill workload assignment response. */
export interface AgentControllerSkillWorkloadAssignmentResult
{
	/** Whether this call committed the assignment or replayed its exact durable value. */
	readonly outcome: "assigned" | "idempotent";
	/** Stable governed skill workload identifier. */
	readonly workloadId: string;
	/** Immutable Kubernetes Job UID stored by the skill authority. */
	readonly workloadUid: string;
}

/** Database-fenced release claim for one assigned governed skill Job. */
export interface AgentControllerSkillWorkloadReleaseClaim
{
	/** Stable governed skill workload identifier. */
	readonly workloadId: string;
	/** ClusterTenant silo owning the Job. */
	readonly siloId: string;
	/** Fixed worker class selecting the immutable controller profile. */
	readonly kind: AgentControllerSkillWorkloadClaim["kind"];
	/** Immutable Kubernetes Job UID expected by release and Pod registration. */
	readonly workloadUid: string;
	/** Database-issued release-claim instant. */
	readonly releaseClaimedAt: string;
	/** Monotonic database release generation. */
	readonly releaseDeliveryCount: number;
	/** Absolute release-claim or bootstrap expiry. */
	readonly expiresAt: string;
}

/** Exact Kubernetes release evidence submitted after a successful conditional patch. */
export interface AgentControllerSkillWorkloadReleaseCommand
{
	/** Exact database release-claim instant. */
	readonly releaseClaimedAt: string;
	/** Exact database release generation. */
	readonly releaseDeliveryCount: number;
	/** Immutable Kubernetes Job UID observed during release. */
	readonly workloadUid: string;
}

/** Exact first-Pod evidence submitted after Kubernetes identity checks pass. */
export interface AgentControllerSkillWorkloadPodRegistrationCommand extends AgentControllerSkillWorkloadReleaseCommand
{
	/** Immutable UID of the sole selected Job-owned Pod. */
	readonly podUid: string;
}

/** Successful or exact-idempotent governed skill workload release response. */
export interface AgentControllerSkillWorkloadReleaseResult
{
	/** Whether this call released the Job or replayed its exact durable value. */
	readonly outcome: "released" | "idempotent";
	/** Stable governed skill workload identifier. */
	readonly workloadId: string;
	/** Immutable Kubernetes Job UID released by this operation. */
	readonly workloadUid: string;
}

/** Successful or exact-idempotent first-Pod registration response. */
export interface AgentControllerSkillWorkloadPodRegistrationResult
{
	/** Whether this call registered the Pod or replayed its exact durable value. */
	readonly outcome: "registered" | "idempotent";
	/** Stable governed skill workload identifier. */
	readonly workloadId: string;
	/** Immutable Kubernetes Job UID owning the Pod. */
	readonly workloadUid: string;
	/** Immutable Kubernetes Pod UID registered for the workload. */
	readonly podUid: string;
}
