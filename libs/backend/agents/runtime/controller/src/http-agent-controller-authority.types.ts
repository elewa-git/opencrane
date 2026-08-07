/** Fetch-compatible function injected into the HTTP adapter. */
export type AgentControllerFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** Rotating projected-token reader injected into the HTTP adapter. */
export type AgentControllerTokenReader = () => Promise<string>;

/** Configuration for the projected-token-authenticated OpenCrane adapter. */
export interface AgentControllerHttpAuthorityOptions
{
	/** Internal OpenCrane base URL with no path, query, or credentials. */
	readonly openCraneInternalUrl: string;
	/** Absolute path of the rotating projected controller token. */
	readonly tokenPath: string;
	/** Hard timeout for one HTTP exchange. */
	readonly requestTimeoutMilliseconds: number;
	/** Optional fetch seam used by focused tests. */
	readonly fetch?: AgentControllerFetch;
	/** Optional rotating-token seam used by focused tests. */
	readonly readToken?: AgentControllerTokenReader;
}
