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
}

/** Database-fenced release claim for one already assigned governed skill Job. */
export interface SkillWorkloadReleaseClaim
{
	/** Stable workload identifier. */
	readonly workloadId: string;
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

/** Persistence authority for controller-only workload claim and suspended-Job assignment. */
export interface SkillWorkloadClaimsRepository
{
	/** Claims one pending workload or returns no current controller work. */
	claimNextAtomically(): Promise<SkillWorkloadClaim | null>;
	/** Binds one exact claim generation to the Kubernetes-issued immutable Job UID. */
	commitAssignmentAtomically(workloadId: string, command: SkillWorkloadAssignmentCommand): Promise<"assigned" | "idempotent" | "conflict">;
	/** Claims one assigned, bootstrap-ready Job for a fenced Kubernetes unsuspend operation. */
	claimNextReleaseAtomically(): Promise<SkillWorkloadReleaseClaim | null>;
	/** Records an exact successful unsuspend or its idempotent replay. */
	commitReleaseAtomically(workloadId: string, command: SkillWorkloadReleaseCommand): Promise<"released" | "idempotent" | "conflict">;
}
