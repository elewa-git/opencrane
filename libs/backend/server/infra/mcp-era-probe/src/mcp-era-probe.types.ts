import type { CanonicalJsonSha256Digest } from "@opencrane/util";

/** A reviewed network address that one HTTPS connection may use. */
export interface McpEraProbeDnsAddress
{
	/** IPv4 or IPv6 address returned by the resolver. */
	readonly address: string;
	/** Address family reported by the resolver. */
	readonly family: 4 | 6;
}

/** Resolves an MCP endpoint host before the transport connects to it. */
export type McpEraProbeDnsResolver = (hostname: string) => Promise<readonly McpEraProbeDnsAddress[]>;

/** One HTTP request sent after its host has passed public-address validation. */
export interface McpEraProbeHttpsRequestCommand
{
	/** HTTPS endpoint whose hostname remains the TLS server name. */
	readonly endpoint: URL;
	/** Reviewed address that the socket lookup must return without another DNS lookup. */
	readonly resolvedAddress: McpEraProbeDnsAddress;
	/** JSON-RPC request bytes. */
	readonly body: Uint8Array;
	/** Headers required by the pinned MCP discovery exchange. */
	readonly headers: Readonly<Record<string, string>>;
	/** Deadline that covers connecting and reading the response. */
	readonly timeoutMilliseconds: number;
	/** Body limit that the request must enforce while reading the response. */
	readonly maximumResponseBytes: number;
	/** Cancels the socket when the complete probe deadline expires. */
	readonly signal: AbortSignal;
}

/** The bounded response returned by the low-level HTTPS request operation. */
export interface McpEraProbeHttpsResponse
{
	/** HTTP status returned before the body is interpreted. */
	readonly status: number;
	/** Lower-cased HTTP response headers. */
	readonly headers: Readonly<Record<string, string | undefined>>;
	/** Complete response bytes after the transport has enforced its body limit. */
	readonly body: Uint8Array;
}

/** Sends one prevalidated HTTPS request; tests provide this function instead of opening a live socket. */
export type McpEraProbeHttpsRequest = (command: McpEraProbeHttpsRequestCommand) => Promise<McpEraProbeHttpsResponse>;

/** Configures the production HTTPS era-probe client and its deterministic test overrides. */
export interface McpEraProbeHttpsClientOptions
{
	/** MCP protocol revision sent in the discovery request. */
	readonly protocolVersion: string;
	/** Deadline applied to the complete discovery exchange. */
	readonly requestTimeoutMilliseconds: number;
	/** Largest discovery response admitted from an external server. */
	readonly maximumResponseBytes: number;
	/** Resolver override used by focused tests. */
	readonly resolve?: McpEraProbeDnsResolver;
	/** HTTPS request override used by focused tests. */
	readonly request?: McpEraProbeHttpsRequest;
}

/** The caller-supplied external endpoint to test with `server/discover`. */
export interface McpEraProbeCommand
{
	/** HTTPS URL of the reviewed remote MCP server. */
	readonly endpoint: string;
}

/** Evidence returned when a remote server completes the pinned discovery exchange. */
export interface McpEraProbeResult
{
	/** MCP protocol revision the server declared in its JSON-RPC discovery result. */
	readonly protocolVersion: string;
	/** Digest of the validated JSON-RPC result stored as registration evidence. */
	readonly evidenceDigest: CanonicalJsonSha256Digest;
}

/**
 * Checks whether a remote endpoint speaks the only MCP revision OpenCrane admits.
 *
 * This is the adapter contract used by the MCP domain. The infrastructure package owns DNS,
 * HTTPS, response limits, and JSON-RPC validation but never decides whether a successful probe
 * authorizes registration. Called by: `__CreateMcpEraProbeWorkflow` during remote-server review.
 */
export interface McpEraProbeClient
{
	/**
	 * Sends `server/discover` to the reviewed HTTPS endpoint.
	 *
	 * @param command - External endpoint selected by the caller.
	 * @returns The declared protocol revision and a digest of the validated discovery result.
	 * @throws McpEraProbeConfigurationError When the endpoint or its DNS results are unsafe.
	 * @throws McpEraProbeTransportError When the remote server cannot be reached safely.
	 * @throws McpEraProbeProtocolError When the response is not the pinned MCP discovery reply.
	 */
	probe(command: McpEraProbeCommand): Promise<McpEraProbeResult>;
}
