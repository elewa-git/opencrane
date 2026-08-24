/** Bounded failure reasons that the MCP domain accepts from application composition. */
export enum McpEraProbeFailureCodes
{
	/** A temporary network, timeout, rate-limit, or server failure may clear. */
	RetryableUnavailable = "retryable_unavailable",
	/** The configured endpoint resolved to an unsafe address or URL. */
	UnsafeEndpoint = "unsafe_endpoint",
	/** The server returned a redirect, oversized body, client error, or malformed reply. */
	InvalidResponse = "invalid_response",
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
