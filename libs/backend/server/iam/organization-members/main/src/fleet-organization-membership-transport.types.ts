/** Server-derived caller evidence sent only through an authenticated Fleet transport. */
export interface FleetOrganizationMembershipTransportIdentity
{
	/** Trusted-host silo selected by OpenCrane. */
	readonly siloId: string;
	/** Verified OIDC subject selected by OpenCrane. */
	readonly subjectId: string;
	/** Peer-visible name from the verified session. */
	readonly displayName: string;
	/** Provider-verified email, or null when unavailable. */
	readonly verifiedEmail: string | null;
}

/** One Fleet membership operation requested by the domain authority. */
export interface FleetOrganizationMembershipTransportRequest
{
	/** Relative Fleet API path. */
	readonly path: string;
	/** Allowed control-plane method. */
	readonly method: "GET" | "POST";
	/** Server-derived caller evidence. */
	readonly identity: FleetOrganizationMembershipTransportIdentity;
	/** Optional JSON command body. */
	readonly body?: object;
	/** Optional retry identity for mutations. */
	readonly idempotencyKey?: string;
}

/** Untrusted Fleet response supplied to domain validation. */
export interface FleetOrganizationMembershipTransportResponse
{
	/** HTTP status returned by Fleet. */
	readonly status: number;
	/** Parsed but untrusted JSON body. */
	readonly body: unknown;
}

/**
 * Carries one authenticated organisation-membership exchange to Fleet.
 *
 * Implementations must bind a rotating workload credential to the request silo and return the body
 * as untrusted data for domain validation. Transport failure must throw; it must never return local
 * membership data or choose a standalone fallback.
 *
 * Called by: FleetOrganizationMembershipAuthority.
 */
export interface FleetOrganizationMembershipTransport
{
	/** Sends one size-bounded authenticated exchange and leaves response interpretation to the domain authority. */
	request(request: FleetOrganizationMembershipTransportRequest): Promise<FleetOrganizationMembershipTransportResponse>;
}
