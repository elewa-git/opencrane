/**
 * Names the workload classes that may use a {@link RuntimeWorkloadClaim}.
 *
 * A product authority selects the class before it issues the claim. The controller then uses that
 * class to obtain its executor-specific projection; it must not treat a claim for one member as a
 * claim for another. This contract does not persist or transport the value itself, so each adopting
 * authority owns any database or API compatibility for these strings.
 */
export enum RuntimeWorkloadClaimClasses
{
	/** The claim runs an admitted MCP server, so its controller must use the MCP-specific executor projection. */
	McpExecutor = "mcp-executor",
	/** The claim validates a saved Draft Python skill, so its controller must use the skill-validation projection. */
	SkillAuthoringValidation = "skill-authoring-validation",
	/** The claim converts one published PDF, so its controller must use the PDF-preprocessor projection. */
	ArtifactPreprocess = "artifact-preprocess",
}

/** Restricts a claim's workload class to the members that its issuing authority supports. */
export type RuntimeWorkloadClaimClass = `${RuntimeWorkloadClaimClasses}`;

/**
 * Carries the reservation a product authority issued for one class-specific workload.
 *
 * The authority selects the workload class and deployment profile before handing this to a
 * controller. The controller returns the claim ID and lease fence in a {@link RuntimeWorkloadBinding}
 * when it binds a workload; it must not replace the class, profile, or execution reference. An
 * expired reservation cannot bind a workload.
 */
export interface RuntimeWorkloadClaim
{
	/** Stable identifier of the product record that owns this claim. */
	readonly claimId: string;
	/** Silo that owns the claim and the workload it authorises. */
	readonly siloId: string;
	/** Class whose server authority supplies the executor-specific projection. */
	readonly workloadClass: RuntimeWorkloadClaimClass;
	/** Deployment-owned profile name selected before the controller receives the claim. */
	readonly profileName: string;
	/** Stable product key that makes repeated claim admission refer to the same work. */
	readonly idempotencyKey: string;
	/** Database-issued lease time that, with `deliveryCount`, identifies the controller delivery allowed to bind. */
	readonly claimedAt: string;
	/** Delivery generation that prevents a controller holding an older delivery from binding this claim. */
	readonly deliveryCount: number;
	/** Database time after which this lease can no longer bind a workload. */
	readonly expiresAt: string;
	/** Opaque class-specific reference that the controller must not interpret or replace. */
	readonly executionReference: string;
}

/**
 * Reports the external workload that a controller bound while holding one issued claim.
 *
 * The receiving authority matches `claimedAt`, `deliveryCount`, and `profileName` to the saved
 * claim before recording this binding. Together they fence an expired or older controller delivery
 * from registering a workload. The optional Pod identity remains absent until the controller has
 * observed the workload's first Pod.
 */
export interface RuntimeWorkloadBinding
{
	/** Claim that this binding may satisfy. */
	readonly claimId: string;
	/** Database time from the lease that permits this binding. */
	readonly claimedAt: string;
	/** Delivery generation from the lease that permits this binding. */
	readonly deliveryCount: number;
	/** Deployment-owned profile that must match the profile in the saved claim. */
	readonly profileName: string;
	/** Immutable UID of the external workload created or adopted for the claim. */
	readonly workloadUid: string;
	/** Immutable UID of the first Pod, absent until Kubernetes has created it. */
	readonly firstPodUid?: string;
}
