/** Bounded transport failure classes reported without any remote or fact payload. */
export type MemoryGatewayTransportFailureCode = "timeout" | "network" | "oversize" | `http_${number}`;

/** Fetch-compatible function injected into the HTTP adapter. */
export type CogneeFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** The single authenticated, read-only exchange allowed against Cognee. */
export interface CogneeSession
{
	/** Search an admitted dataset and return the parsed response body. */
	search(body: unknown): Promise<unknown>;
}

/** Configuration for the Cognee-backed memory gateway adapter. */
export interface CogneeMemoryGatewayHttpOptions
{
	/** In-cluster memory-gateway origin with no path, query, or credentials. */
	readonly baseUrl: string;
	/** Hard timeout independently applied to every HTTP exchange. */
	readonly requestTimeoutMilliseconds: number;
	/** Absolute path to the rotating projected token accepted by the memory gateway. */
	readonly serverTokenFile: string;
	/** Optional fetch seam used by focused tests. */
	readonly fetch?: CogneeFetch;
	/** Optional projected-token reader seam used by focused tests. */
	readonly readServerToken?: () => Promise<string>;
}
