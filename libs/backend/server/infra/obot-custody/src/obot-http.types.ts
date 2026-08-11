/** Bounded Obot transport failure classes reported without any remote body or credential. */
export type ObotTransportFailureCode = "timeout" | "network" | "oversize" | `http_${number}`;

/** Fetch-compatible function injected into the Obot HTTP session. */
export type ObotFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** HTTP methods the authenticated Obot management session may issue. */
export type ObotRequestMethod = "GET" | "POST" | "DELETE";

/** The single authenticated exchange primitive shared by every Obot management adapter. */
export interface ObotSession
{
	/** Issue one bounded, timeout-guarded JSON exchange and return the parsed response body. */
	request(path: string, method: ObotRequestMethod, body?: unknown): Promise<unknown>;
	/** Issue one bounded MCP JSON-RPC exchange, accepting JSON or server-sent events. */
	mcpRequest(path: string, body: unknown, sessionId?: string): Promise<ObotMcpExchangeResponse>;
}

/** Parsed response metadata from one bounded MCP JSON-RPC exchange. */
export interface ObotMcpExchangeResponse
{
	/** Parsed JSON-RPC payload; raw response bytes never leave the session. */
	readonly payload: unknown;
	/** Validated Obot session identifier to echo on the next exchange, when present. */
	readonly sessionId: string | null;
}

/** Configuration for the authenticated Obot management HTTP session. */
export interface ObotHttpOptions
{
	/** In-cluster Obot origin (`http`, `*.svc.cluster.local`) with no path, query, or credentials. */
	readonly baseUrl: string;
	/** Hard timeout independently applied to every HTTP exchange; 1s through 300s. */
	readonly requestTimeoutMilliseconds: number;
	/** Absolute path of the mounted Obot service credential, re-read on every call. */
	readonly serviceTokenFile: string;
	/** Optional fetch seam used by focused tests. */
	readonly fetch?: ObotFetch;
	/** Optional service-token reader seam used by focused tests. */
	readonly readServiceToken?: () => Promise<string>;
	/** Optional process-lifecycle signal that aborts active exchanges before dependency shutdown. */
	readonly shutdownSignal?: AbortSignal;
}
