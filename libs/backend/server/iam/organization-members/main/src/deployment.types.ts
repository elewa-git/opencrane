/**
 * Selects which authority answers organisation membership and billing requests for this process.
 *
 * The value comes from startup configuration and is never persisted or accepted from an HTTP request.
 * The application composes exactly one branch; an unknown value stops startup instead of enabling a
 * Fleet-to-standalone fallback.
 */
export enum OrganizationMembershipDeploymentModes
{
	/** OpenCrane stores memberships and invitations in its silo database. */
	Standalone = "standalone",
	/** Fleet handles every operation, including seat and payment checks. */
	Fleet = "fleet",
}

/** Standalone invitation settings fixed by deployment, never by a browser request. */
export interface StandaloneOrganizationMembershipConfig
{
	/** Lifetime applied to each created or resent token generation. */
	readonly invitationTtlMilliseconds: number;
	/** Mounted HMAC key bytes used to authenticate invitation coordinates. */
	readonly invitationSigningKey: Uint8Array;
	/** Browser origin used to author absolute shareable acceptance links. */
	readonly publicBaseUrl: string;
}
