/** Bounded failure reasons that the MCP domain accepts from application composition. */
export enum McpEraProbeFailureCodes
{
	/** A temporary network, timeout, rate-limit, or server failure may clear. */
	RetryableUnavailable = "retryable_unavailable",
	/** The configured endpoint resolved to an unsafe address or URL. */
	UnsafeEndpoint = "unsafe_endpoint",
	/** The endpoint did not implement the MCP discovery response contract. */
	NotMcpServer = "not_mcp_server",
	/** The discovered MCP server did not support the pinned 2026-07-28 protocol. */
	UnsupportedMcpProtocolVersion = "unsupported_mcp_protocol_version",
	/** The endpoint remained unavailable through every reviewed retry attempt. */
	RetryExhausted = "retry_exhausted",
}

/** Domain-owned probe failure passed from the application adapter boundary. */
export class McpEraProbeFailure extends Error
{
	/** Closed reason used by the state table without retaining remote error text. */
	readonly code: McpEraProbeFailureCodes;

	/** Create a bounded failure whose message contains no endpoint or remote response. */
	constructor(code: McpEraProbeFailureCodes)
	{
		super(`MCP protocol check failed: ${code}`);
		this.name = "McpEraProbeFailure";
		this.code = code;
	}
}
