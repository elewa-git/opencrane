/** One claim the database handed out for a pending skill workload. */
export interface SkillWorkloadClaim
{
	/** Stable durable workload identifier. */
	readonly workloadId: string;
	/** Silo owning the exact revision and workload. */
	readonly siloId: string;
	/** Workload class: authoring, or running a published tool. */
	readonly kind: "authoring" | "tool-runner";
	/** Immutable SkillRevision selected before the claim. */
	readonly skillRevisionId: string;
	/** Delivery counter, raised by one on every claim. An out-of-date controller replica holds an older number and is rejected. */
	readonly deliveryCount: number;
	/** Timestamp the database set for this claim. It is what identifies the claim later. */
	readonly claimedAt: string;
	/** Absolute claim expiry calculated from database time. */
	readonly expiresAt: string;
}

/** What the controller sends back after it has created the suspended Kubernetes Job. */
export interface SkillWorkloadAssignmentCommand
{
	/** The `claimedAt` value the controller was given. It must still match the stored row. */
	readonly claimedAt: string;
	/** The `deliveryCount` the controller was given. It must still match the stored row. */
	readonly deliveryCount: number;
	/** API-issued immutable Kubernetes Job UID. */
	readonly workloadUid: string;
	/** Reference the controller sends once. Only its hash is stored. */
	readonly bootstrapReference: string;
	/** Deployment-owned namespace selected by the reviewed controller profile. */
	readonly namespace: string;
}

/** One claim to unsuspend a Job that has already been assigned. */
export interface SkillWorkloadReleaseClaim
{
	/** Stable workload identifier. */
	readonly workloadId: string;
	/** ClusterTenant silo that owns the released Job. */
	readonly siloId: string;
	/** Workload class. It picks which controller profile is used. */
	readonly kind: "authoring" | "tool-runner";
	/** Immutable Job UID that Kubernetes must release. */
	readonly workloadUid: string;
	/** Database-issued release-claim instant. */
	readonly releaseClaimedAt: string;
	/** Release counter, raised by one on every release claim, so an out-of-date controller is rejected. */
	readonly releaseDeliveryCount: number;
	/** When this release claim expires, measured by the database clock. */
	readonly expiresAt: string;
}

/** What the controller sends after Kubernetes has actually unsuspended the Job. */
export interface SkillWorkloadReleaseCommand
{
	/** Exact release claim instant returned by the authority. */
	readonly releaseClaimedAt: string;
	/** Exact release generation returned by the authority. */
	readonly releaseDeliveryCount: number;
	/** Immutable Kubernetes UID observed during release. */
	readonly workloadUid: string;
}

/** What the controller sends after it has seen the unsuspended Job's first Pod. */
export interface SkillWorkloadPodRegistrationCommand extends SkillWorkloadReleaseCommand
{
	/** Kubernetes UID of the worker Pod, found by looking it up under the Job UID. */
	readonly podUid: string;
}
