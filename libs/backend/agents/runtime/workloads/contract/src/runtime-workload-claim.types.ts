/**
 * Names the workload classes that may use a {@link RuntimeWorkloadClaim}.
 *
 * A product authority selects the class before it issues the claim. The controller then uses that
 * class to obtain its executor-specific projection; it must not treat a claim for one member as a
 * claim for another. The shared claim transports this value, while each adopting authority owns
 * how it stores or validates the string at its database or API boundary. Changing a value is
 * therefore a compatibility change for every adopter.
 */
export enum RuntimeWorkloadClaimClasses
{
	/** The claim runs an admitted MCP server through the MCP executor profile. */
	McpExecutor = "mcp-executor",
}

/**
 * Restricts a shared claim to a class that both its issuing authority and controller understand.
 *
 * A product authority and its controller use this alias when they store or send a claim. Adding or
 * renaming a member requires every adopting database and API contract to change with it. An adopter
 * must reject an unknown value instead of treating it as another workload class.
 *
 * @see RuntimeWorkloadClaimClasses
 */
export type RuntimeWorkloadClaimClass = `${RuntimeWorkloadClaimClasses}`;

/**
 * Carries the reservation a product authority issued for one class-specific workload.
 *
 * The authority selects the workload class and deployment profile before handing this to a
 * controller. The controller returns the claim ID and lease fence in a
 * {@link RuntimeWorkloadBinding} when it binds a workload; it must not replace the class, profile,
 * or execution reference. An expired reservation cannot bind a workload.
 */
export interface RuntimeWorkloadClaim
{
	/** Stable identifier of the product record that owns this claim. */
	readonly claimId: string;
	/** Silo that owns the claim and the workload it authorises. */
	readonly siloId: string;
	/** Class whose server authority supplies the executor-specific projection. */
	readonly workloadClass: RuntimeWorkloadClaimClass;
	/** Deployment-owned profile selected before the controller receives the claim. */
	readonly profileName: string;
	/** Stable product key that makes repeated claim admission refer to the same work. */
	readonly idempotencyKey: string;
	/** Database time that, with `deliveryCount`, identifies the controller delivery allowed to bind. */
	readonly claimedAt: string;
	/** Delivery generation that stops a controller holding an older delivery from binding the claim. */
	readonly deliveryCount: number;
	/** Database time after which this lease can no longer bind a workload. */
	readonly expiresAt: string;
	/** Opaque class-specific reference that the controller must not interpret or replace. */
	readonly executionReference: string;
}

/**
 * Reports the external workload that a controller bound while holding one issued claim.
 *
 * The receiving authority matches `claimedAt`, `deliveryCount`, and `profileName` to the saved claim
 * before recording this binding. Together they stop an expired or older controller delivery from
 * registering a workload. The optional Pod identity remains absent until the controller has
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
