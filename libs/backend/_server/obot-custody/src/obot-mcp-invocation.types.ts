import type { JsonValue } from "@opencrane/util";

/**
 * One request to invoke an MCP tool through an Obot custody reference.
 *
 * The runtime never holds the underlying credential: it names only the OPAQUE `obotCustodyReference`
 * Obot minted, the tool, and the (already validated) arguments. `allowedTools` is the immutable
 * allow-list copied from the revision's `AgentRevisionIntegrationAssignment`; only a tool present in
 * it may be invoked.
 */
export interface ObotMcpToolInvocationCommand
{
	/** Silo that owns the integration and its custody reference. */
	readonly siloId: string;
	/** Product integration identity the tool belongs to. */
	readonly integrationId: string;
	/** Opaque custody reference minted by Obot; never a credential and never locally synthesized. */
	readonly obotCustodyReference: string;
	/** MCP tool name being invoked. */
	readonly toolName: string;
	/** Validated, bounded tool arguments. */
	readonly arguments: JsonValue;
	/** Immutable allow-list from the revision's integration assignment. */
	readonly allowedTools: readonly string[];
}

/** Opaque, gateway-originated result of one MCP tool invocation. */
export interface ObotMcpToolResult
{
	/** Result payload as returned by Obot; opaque to OpenCrane. */
	readonly content: JsonValue;
}

/**
 * Runtime-neutral boundary for invoking an MCP tool through Obot custody.
 *
 * Every implementation MUST enforce the `allowedTools` allow-list before contacting any transport,
 * so a tool outside the revision's assignment is rejected fail-closed regardless of transport state.
 */
export interface ObotMcpInvocationPort
{
	/** Invokes an allow-listed MCP tool, returning only the gateway-originated result. */
	invokeTool(command: ObotMcpToolInvocationCommand): Promise<ObotMcpToolResult>;
}
