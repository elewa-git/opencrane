/** Fetch shape injected into the provider HTTP owner by tests and application composition. */
export type CogneeProviderFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** One replayable request to the private Cognee provider. */
export interface CogneeProviderHttpCommand
{
	/** HTTP method required by the pinned Cognee route. */
	readonly method: string;
	/** Absolute-path reference beneath the configured provider origin. */
	readonly path: string;
	/** Non-authentication headers required by the pinned Cognee route. */
	readonly headers?: Readonly<Record<string, string>>;
	/** Replayable request bytes or text; streams are excluded because a 401 retry needs a fresh body. */
	readonly body?: string | Uint8Array;
	/** Optional caller cancellation combined with the provider request timeout. */
	readonly signal?: AbortSignal;
}

/** Bounded provider response returned without exposing authentication state. */
export interface CogneeProviderHttpResponse
{
	/** HTTP response status from Cognee. */
	readonly status: number;
	/** Declared media type, when Cognee supplied one. */
	readonly contentType: string | null;
	/** Complete response bytes after the HTTP owner enforces its configured ceiling. */
	readonly body: Uint8Array;
}

/** Internal HTTP exchange used by the provider session owner. */
export interface CogneeProviderHttpClient
{
	/** Validate, send, and consume one request, optionally attaching the session-owned bearer. */
	send(command: CogneeProviderHttpCommand, bearerToken?: string): Promise<CogneeProviderHttpResponse>;
}

/** Construction values for the bounded provider HTTP exchange. */
export interface CogneeProviderHttpOptions
{
	/** Provider origin with no path, credentials, query, or fragment. */
	readonly baseUrl: string;
	/** Maximum time for connection, response headers, and complete response consumption. */
	readonly requestTimeoutMilliseconds: number;
	/** Maximum response bytes retained in memory. */
	readonly maximumResponseBytes: number;
	/** Optional fetch replacement used by focused tests. */
	readonly fetch?: CogneeProviderFetch;
}
