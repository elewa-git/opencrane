/** One database-owned claim generation for a pending governed skill workload. */
export interface SkillWorkloadClaim
{
	/** Stable durable workload identifier. */
	readonly workloadId: string;
	/** Silo owning the exact revision and workload. */
	readonly siloId: string;
	/** Authoring or authorised tool execution class. */
	readonly kind: "authoring" | "tool-runner";
	/** Immutable SkillRevision selected before the claim. */
	readonly skillRevisionId: string;
	/** Monotonic delivery generation fencing stale controller replicas. */
	readonly deliveryCount: number;
	/** Database-issued instant that identifies this exact claim. */
	readonly claimedAt: string;
	/** Absolute claim expiry calculated from database time. */
	readonly expiresAt: string;
}

/** Database fence supplied after the controller creates one suspended Kubernetes Job. */
export interface SkillWorkloadAssignmentCommand
{
	/** Exact claim generation accepted by the controller authority. */
	readonly claimedAt: string;
	/** Exact claim delivery generation accepted by the controller authority. */
	readonly deliveryCount: number;
	/** API-issued immutable Kubernetes Job UID. */
	readonly workloadUid: string;
	/** Opaque reference received transiently from the controller and persisted only as a hash. */
	readonly bootstrapReference: string;
	/** Deployment-owned namespace selected by the reviewed controller profile. */
	readonly namespace: string;
}

/** Database-fenced release claim for one already assigned governed skill Job. */
export interface SkillWorkloadReleaseClaim
{
	/** Stable workload identifier. */
	readonly workloadId: string;
	/** ClusterTenant silo that owns the released Job. */
	readonly siloId: string;
	/** Fixed workload class selecting the immutable controller profile. */
	readonly kind: "authoring" | "tool-runner";
	/** Immutable Job UID that Kubernetes must release. */
	readonly workloadUid: string;
	/** Database-issued release-claim instant. */
	readonly releaseClaimedAt: string;
	/** Monotonic release generation that fences stale controllers. */
	readonly releaseDeliveryCount: number;
	/** Absolute database-derived release-claim expiry. */
	readonly expiresAt: string;
}

/** Exact Kubernetes release evidence committed only after the Job patch succeeds. */
export interface SkillWorkloadReleaseCommand
{
	/** Exact release claim instant returned by the authority. */
	readonly releaseClaimedAt: string;
	/** Exact release generation returned by the authority. */
	readonly releaseDeliveryCount: number;
	/** Immutable Kubernetes UID observed during release. */
	readonly workloadUid: string;
}

/** Exact first-Pod evidence committed only after the released Job owns the Pod. */
export interface SkillWorkloadPodRegistrationCommand extends SkillWorkloadReleaseCommand
{
	/** Immutable Kubernetes UID of the worker Pod selected through the Job UID. */
	readonly podUid: string;
}
