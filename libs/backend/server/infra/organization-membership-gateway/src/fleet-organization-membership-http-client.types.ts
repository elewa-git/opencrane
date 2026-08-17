/** Fetch-compatible seam used by the Fleet membership HTTP adapter. */
export type FleetOrganizationMembershipFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** Deployment-frozen coordinates for the Fleet membership receiver. */
export interface FleetOrganizationMembershipHttpClientConfig
{
	/** HTTPS origin of the Fleet membership-and-billing receiver. */
	readonly baseUrl: string;
	/** Exact silo the receiver must bind to this OpenCrane workload identity. */
	readonly credentialSiloId: string;
	/** Absolute path to the rotating audience-bound ServiceAccount token. */
	readonly projectedTokenPath: string;
	/** Hard timeout independently applied to each exchange. */
	readonly timeoutMilliseconds: number;
	/** Optional fetch seam used by focused tests. */
	readonly fetch?: FleetOrganizationMembershipFetch;
	/** Optional projected-token reader used by focused tests. */
	readonly readProjectedToken?: () => Promise<string>;
}

/** Server-derived human identity forwarded under one authenticated workload identity. */
export interface FleetOrganizationMembershipRequestIdentity
{
	/** Trusted-host silo selected by OpenCrane. */
	readonly siloId: string;
	/** Verified OIDC subject selected by OpenCrane. */
	readonly subjectId: string;
	/** Peer-visible name selected from the verified session. */
	readonly displayName: string;
	/** Provider-verified email, or null when the provider did not verify one. */
	readonly verifiedEmail: string | null;
}

/** One bounded Fleet membership exchange. */
export interface FleetOrganizationMembershipHttpRequest
{
	/** Relative API path owned by the membership authority. */
	readonly path: string;
	/** Allowed HTTP method for this control-plane client. */
	readonly method: "GET" | "POST";
	/** Server-derived caller evidence; no browser field may supply it. */
	readonly identity: FleetOrganizationMembershipRequestIdentity;
	/** Optional JSON request body. */
	readonly body?: object;
	/** Optional retry identity for mutation endpoints. */
	readonly idempotencyKey?: string;
}

/** Status and untrusted JSON body returned to the domain authority. */
export interface FleetOrganizationMembershipHttpResponse
{
	/** Fleet HTTP status. */
	readonly status: number;
	/** Parsed but untrusted response body. */
	readonly body: unknown;
}
