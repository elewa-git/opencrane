/** Fetch-compatible function injected into the HTTP adapter. */
export type AgentControllerFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** Reads the current projected token. Called again on every request, because Kubernetes rotates the token in place. */
export type AgentControllerTokenReader = () => Promise<string>;

/**
 * Configuration for the OpenCrane client that authenticates with a projected token. Every field is
 * validated by {@link __CreateHttpAgentControllerAuthority} before the client is returned.
 */
export interface AgentControllerHttpAuthorityOptions
{
	/** Internal OpenCrane base URL with no path, query, or credentials. */
	readonly openCraneInternalUrl: string;
	/** Absolute path of the rotating projected controller token. */
	readonly tokenPath: string;
	/** Hard timeout for one HTTP exchange. */
	readonly requestTimeoutMilliseconds: number;
	/** Optional fetch replacement, so tests can answer requests without a network. Defaults to global `fetch`. */
	readonly fetch?: AgentControllerFetch;
	/** Optional token-reader replacement, so tests can supply a token without a file on disk. Defaults to reading `tokenPath`. */
	readonly readToken?: AgentControllerTokenReader;
}
