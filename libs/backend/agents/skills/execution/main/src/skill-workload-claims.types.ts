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

/** Persistence authority for controller-only workload claim and suspended-Job assignment. */
export interface SkillWorkloadClaimsRepository
{
	/** Claims one pending workload or returns no current controller work. */
	claimNextAtomically(): Promise<SkillWorkloadClaim | null>;
	/** Binds one exact claim generation to the Kubernetes-issued immutable Job UID. */
	commitAssignmentAtomically(workloadId: string, command: SkillWorkloadAssignmentCommand): Promise<"assigned" | "idempotent" | "conflict">;
}
