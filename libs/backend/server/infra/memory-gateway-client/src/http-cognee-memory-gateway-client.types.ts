/**
 * Why one memory-gateway exchange failed, with no detail that could leak a body or a fact.
 *
 * `timeout`  - the per-exchange deadline fired.
 * `network`  - fetch itself rejected: DNS, connection refused, or a refused redirect.
 * `oversize` - the response was larger than the 256 KiB ceiling and was cancelled unread.
 * `http_<status>` - the gateway answered non-2xx; the body was cancelled, never read.
 *
 * This code is the only thing that leaves the transport, which is why it is safe to log or store as
 * an invocation's failure code.
 */
export type MemoryGatewayTransportFailureCode = "timeout" | "network" | "oversize" | `http_${number}`;

/** Fetch-compatible function injected into the HTTP adapter. */
export type CogneeFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/**
 * The single authenticated, read-only call allowed against Cognee.
 *
 * There is deliberately just one method: the memory gateway exposes search and nothing else, so no
 * code path in OpenCrane can write to Cognee through this session.
 *
 * Called by: cognee-http.ts (`__CreateCogneeSession` builds it) and
 * http-cognee-memory-gateway-client.ts, which is its only consumer.
 */
export interface CogneeSession
{
	/**
	 * Sends one search request and returns the parsed response body.
	 *
	 * @param body - The search request; the client fills in query, `search_type`, `dataset_ids`, and
	 *   `top_k`.
	 * @returns The parsed body, or null when the gateway answered 2xx with nothing. Untrusted — the
	 *   caller converts it with `__ParseSearchFacts` or `__ParseScopedFacts`.
	 * @throws MemoryGatewayTransportError When the gateway cannot be reached, times out, answers
	 *   non-2xx, or exceeds the response ceiling.
	 * @throws MemoryGatewayProtocolError When the body is not valid JSON.
	 */
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
