import type { JsonValue } from "@opencrane/util";

/**
 * Describes a tool returned by the uploaded MCP server after its protocol fields pass validation.
 *
 * This shape does not grant permission to call the tool. The caller must still compare it with the
 * saved server revision and use ToolInvocation authority before execution.
 * @see ToolInvocationClaim
 * @see https://modelcontextprotocol.io/specification/2026-07-28
 */
export interface McpExecutorDiscoveredTool
{
	/** Stable tool name used by a later `tools/call` request. */
	readonly name: string;
	/** Human-readable description, or null when the server omitted it. */
	readonly description: string | null;
	/** JSON Schema used to validate arguments before ToolInvocation admission. */
	readonly inputSchema: JsonValue;
}

/**
 * Carries the checked result of an MCP tool call back to ToolInvocation authority.
 *
 * `isError` is provider data rather than a protocol failure; malformed response envelopes throw
 * {@link McpExecutorProtocolError} instead of producing this type.
 * @see ToolInvocationCompletionResult
 * @see https://modelcontextprotocol.io/specification/2026-07-28
 */
export interface McpExecutorToolCallResult
{
	/** Whether the MCP server reported a tool-level failure. */
	readonly isError: boolean;
	/** Checked MCP content blocks; the transport must enforce its response-byte limit before parsing. */
	readonly content: readonly JsonValue[];
}

/**
 * Reports that an uploaded process did not return the pinned MCP protocol shape.
 *
 * Response parsers throw this error for malformed envelopes and fields. Network and HTTP failures
 * remain transport errors because this package never opens the connection.
 * @see https://modelcontextprotocol.io/specification/2026-07-28
 */
export class McpExecutorProtocolError extends Error
{
	constructor(message: string)
	{
		super(message);
		this.name = "McpExecutorProtocolError";
	}
}
