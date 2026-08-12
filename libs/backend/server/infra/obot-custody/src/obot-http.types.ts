/**
 * Why one Obot exchange failed, with no detail that could leak a response body or a credential.
 *
 * `timeout`  - the per-exchange deadline fired, or the process began shutting down.
 * `network`  - fetch itself rejected: DNS, connection refused, or a refused redirect.
 * `oversize` - the response was larger than the 256 KiB ceiling and was cancelled unread.
 * `http_<status>` - Obot answered non-2xx; the body was cancelled, never read.
 *
 * This code is the only thing that leaves the transport, which is why it is safe to log or store on
 * a failure row. Callers match on it: http-obot-custody.ts treats `http_404` on revoke as
 * already-done, and http-obot-mcp-invocation.ts turns `http_401`/`http_403` into
 * `ObotMcpAuthenticationError`/`ObotMcpAuthorizationError`.
 */
export type ObotTransportFailureCode = "timeout" | "network" | "oversize" | `http_${number}`;

/** Fetch-compatible function injected into the Obot HTTP session. */
export type ObotFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** HTTP methods the authenticated Obot management session may issue. */
export type ObotRequestMethod = "GET" | "POST" | "DELETE";

/**
 * The one authenticated way anything in OpenCrane talks to Obot.
 *
 * Both Obot adapters share it, so the bearer-token handling, the hard timeout, the redirect refusal,
 * the 256 KiB response ceiling, and the suppression of automatic HTTP tracing are written once. The
 * session chooses no paths and validates no fields: each adapter picks its own path and must treat
 * every response field as untrusted.
 *
 * Called by: obot-http.ts (`__CreateObotSession` builds it), and both adapters take one as their
 * only dependency — http-obot-custody.ts and http-obot-mcp-invocation.ts. Composed in
 * apps/opencrane/src/infra/obot/obot-adapters.factory.ts.
 */
export interface ObotSession
{
	/**
	 * Sends one Obot management call and returns its parsed JSON body.
	 *
	 * @param path - Path on the configured Obot origin, for example `/api/mcp-servers`.
	 * @param method - GET, POST, or DELETE.
	 * @param body - Optional value serialised as the JSON request body.
	 * @returns The parsed body, or null when Obot answered 2xx with nothing. Every field is untrusted
	 *   and must be checked by the calling adapter.
	 * @throws ObotTransportError When Obot cannot be reached, times out, answers non-2xx, or exceeds
	 *   the response ceiling.
	 * @throws ObotProtocolError When the body is not valid JSON.
	 */
	request(path: string, method: ObotRequestMethod, body?: unknown): Promise<unknown>;
	/**
	 * Sends one MCP JSON-RPC call and returns the reply plus the MCP session id.
	 *
	 * Obot may answer either as `application/json` or as a `text/event-stream`; both are accepted, and
	 * only the first complete data frame of a stream is read. Pass the `sessionId` from the previous
	 * exchange so a stateful MCP server keeps the same session.
	 *
	 * @param path - The MCP proxy path for one custody reference.
	 * @param body - The JSON-RPC request object to send.
	 * @param sessionId - Session id from the previous exchange, when there was one.
	 * @returns The parsed reply and the validated session id, which is null when Obot sent none.
	 * @throws ObotTransportError When Obot cannot be reached, times out, answers non-2xx, or exceeds
	 *   the response ceiling.
	 * @throws ObotProtocolError When the body is empty, uses an unsupported content type, carries no
	 *   data frame, is not valid JSON, or returns an unusable session id.
	 * @see https://modelcontextprotocol.io/specification/2025-06-18 - the MCP revision this transport
	 *   serves, including the session header carried between exchanges.
	 * @see https://www.jsonrpc.org/specification - JSON-RPC 2.0, the request/response shape of `body`.
	 */
	mcpRequest(path: string, body: unknown, sessionId?: string): Promise<ObotMcpExchangeResponse>;
}

/**
 * The two things one MCP exchange gives back to an adapter.
 *
 * Raw bytes, response headers, and Obot's error details stop at the session; an adapter only ever
 * sees these two fields.
 */
export interface ObotMcpExchangeResponse
{
	/** The parsed JSON-RPC reply. Untrusted: the adapter checks every field it reads. */
	readonly payload: unknown;
	/** Session id to pass to the next exchange. Null when Obot sent none, which is normal for MCP servers that hold no session state. */
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
	/** Process-lifecycle signal that aborts active exchanges before dependency shutdown. */
	readonly shutdownSignal: AbortSignal;
}
