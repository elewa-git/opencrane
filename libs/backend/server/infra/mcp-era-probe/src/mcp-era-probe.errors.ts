/** Explains why endpoint configuration was refused before a connection opened. */
export class McpEraProbeConfigurationError extends Error
{
	/** Bounded category that contains no untrusted URL. */
	readonly code: "invalid_endpoint" | "unsafe_address";

	/** Create a configuration error without retaining external input. */
	constructor(code: "invalid_endpoint" | "unsafe_address")
	{
		super(`MCP era probe configuration failed: ${code}`);
		this.name = "McpEraProbeConfigurationError";
		this.code = code;
	}
}

/** Explains why the HTTPS exchange could not safely return a discovery body. */
export class McpEraProbeTransportError extends Error
{
	/** Bounded category that carries no remote body, URL, or network error text. */
	readonly code: "network" | "timeout" | "redirect" | "oversize" | `http_${number}`;

	/** Create a transport error without exposing remote data. */
	constructor(code: "network" | "timeout" | "redirect" | "oversize" | `http_${number}`)
	{
		super(`MCP era probe transport failed: ${code}`);
		this.name = "McpEraProbeTransportError";
		this.code = code;
	}
}

/** Explains why the remote response was not a usable discovery reply. */
export class McpEraProbeProtocolError extends Error
{
	/** Bounded category that includes no remote JSON-RPC data. */
	readonly code: "malformed_discovery";

	/** Create a protocol error without retaining the response. */
	constructor(code: "malformed_discovery")
	{
		super(`MCP era probe protocol failed: ${code}`);
		this.name = "McpEraProbeProtocolError";
		this.code = code;
	}
}
