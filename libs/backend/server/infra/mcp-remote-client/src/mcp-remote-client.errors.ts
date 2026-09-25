import { McpRemoteDeliveryStates, type McpRemoteProtocolFailureCodes } from "./mcp-remote-client.types";

/** Explains why endpoint or authorization input was refused before a request opened. */
export class McpRemoteConfigurationError extends Error
{
	/** Bounded category that contains no endpoint or credential material. */
	readonly code: "invalid_authorization" | "invalid_endpoint" | "invalid_request" | "unsafe_address";
	/** Proves that configuration refusal happened before remote dispatch. */
	readonly delivery = McpRemoteDeliveryStates.ProvenNotDispatched;

	/** Create a configuration error without retaining external input. */
	constructor(code: "invalid_authorization" | "invalid_endpoint" | "invalid_request" | "unsafe_address")
	{
		super(`MCP remote configuration failed: ${code}`);
		this.name = "McpRemoteConfigurationError";
		this.code = code;
	}
}

/** Explains why one HTTPS exchange did not yield a bounded response. */
export class McpRemoteTransportError extends Error
{
	/** Bounded category that carries no response, endpoint, header, or native error text. */
	readonly code: "aborted" | "network" | "oversize" | "redirect" | "timeout" | `http_${number}`;
	/** Reports whether request bytes may have reached the remote server. */
	readonly delivery: McpRemoteDeliveryStates;

	/** Create a transport error with a conservative delivery classification. */
	constructor(code: "aborted" | "network" | "oversize" | "redirect" | "timeout" | `http_${number}`, delivery: McpRemoteDeliveryStates)
	{
		super(`MCP remote transport failed: ${code}`);
		this.name = "McpRemoteTransportError";
		this.code = code;
		this.delivery = delivery;
	}
}

/** Explains why a response did not satisfy the selected MCP operation. */
export class McpRemoteProtocolError extends Error
{
	/** Bounded operation-specific category that contains no remote payload. */
	readonly code: McpRemoteProtocolFailureCodes;
	/** A response proves request dispatch may already have occurred. */
	readonly delivery = McpRemoteDeliveryStates.MaybeDispatched;

	/** Create a protocol error without retaining response data. */
	constructor(code: McpRemoteProtocolFailureCodes)
	{
		super(`MCP remote protocol failed: ${code}`);
		this.name = "McpRemoteProtocolError";
		this.code = code;
	}
}
