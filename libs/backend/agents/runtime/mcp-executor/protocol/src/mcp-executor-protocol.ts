import type { JsonValue } from "@opencrane/util";

import { McpExecutorProtocolError, type McpExecutorDiscoveredTool, type McpExecutorToolCallResult } from "./mcp-executor-protocol.types";
import { _McpExecutorContentBlocks, _ParseMcpExecutorDiscoveredTools as _ParseDiscoveredTools } from "./mcp-executor-protocol.validator";

/**
 * Selects the Model Context Protocol revision admitted by the OCI MCP executor.
 *
 * Request builders announce this revision, and the discovery parser rejects a server that does not
 * include it in its completed discovery result.
 * @see https://modelcontextprotocol.io/specification/2026-07-28
 */
export const MCP_EXECUTOR_PROTOCOL_VERSION = "2026-07-28" as const;
const _DISCOVERY_ID = "opencrane-mcp-discovery";
const _TOOLS_LIST_ID = "opencrane-mcp-tools";

/**
 * Builds the discovery request that must succeed before OpenCrane accepts live tool definitions.
 *
 * @returns A JSON-RPC `server/discover` request pinned to MCP 2026-07-28.
 * @see https://modelcontextprotocol.io/specification/2026-07-28
 */
export function __BuildMcpExecutorDiscoveryRequest(): JsonValue
{
	return { jsonrpc: "2.0", id: _DISCOVERY_ID, method: "server/discover", params: { _meta: { protocolVersion: MCP_EXECUTOR_PROTOCOL_VERSION, clientCapabilities: {} } } };
}

/** Returns the result only when the response matches the request id and contains no JSON-RPC error. */
function _Result(payload: unknown, expectedId: string): Record<string, unknown>
{
	if (typeof payload !== "object" || payload === null || Array.isArray(payload))
		throw new McpExecutorProtocolError("MCP response was not a JSON-RPC object");
	const envelope = payload as Record<string, unknown>;
	if (envelope["jsonrpc"] !== "2.0" || envelope["id"] !== expectedId || Object.hasOwn(envelope, "error") || typeof envelope["result"] !== "object" || envelope["result"] === null || Array.isArray(envelope["result"]))
		throw new McpExecutorProtocolError("MCP response did not match the request");
	return envelope["result"] as Record<string, unknown>;
}

/**
 * Checks that discovery completed and explicitly supports MCP 2026-07-28.
 *
 * @throws McpExecutorProtocolError When the response is not the matching pinned discovery result.
 * @see https://modelcontextprotocol.io/specification/2026-07-28
 */
export function __ParseMcpExecutorDiscoveryResponse(payload: unknown): void
{
	const result = _Result(payload, _DISCOVERY_ID);
	const supportedVersions = result["supportedVersions"];
	if (result["resultType"] !== "complete" || !Array.isArray(supportedVersions) || !supportedVersions.includes(MCP_EXECUTOR_PROTOCOL_VERSION))
		throw new McpExecutorProtocolError("MCP server does not support protocol 2026-07-28");
}

/**
 * Builds the tool-list request used after version discovery succeeds.
 *
 * @returns A JSON-RPC `tools/list` request.
 * @see https://modelcontextprotocol.io/specification/2026-07-28
 */
export function __BuildMcpExecutorToolsListRequest(): JsonValue
{
	return { jsonrpc: "2.0", id: _TOOLS_LIST_ID, method: "tools/list", params: {} };
}

/**
 * Checks the live tool list without accepting duplicate names or malformed schemas.
 *
 * @returns At most 256 unique tool definitions with JSON Schema object inputs.
 * @throws McpExecutorProtocolError When the response or a tool definition is malformed.
 * @see https://modelcontextprotocol.io/specification/2026-07-28
 */
export function __ParseMcpExecutorToolsListResponse(payload: unknown): readonly McpExecutorDiscoveredTool[]
{
	const tools = _Result(payload, _TOOLS_LIST_ID)["tools"];
	return __ParseMcpExecutorDiscoveredTools(tools);
}

/**
 * Validates discovered MCP tools before the companion accepts the server's complete tool list.
 *
 * The schema rejects malformed records and this function rejects duplicate names across the list.
 * Callers receive all checked definitions or a protocol error; no partial list is returned.
 *
 * Called by: {@link __ParseMcpExecutorToolsListResponse} and mcp-companion-wire.ts.
 * @param tools - Untrusted `tools` field from an MCP `tools/list` result.
 * @returns At most 256 unique tool definitions with object-shaped input schemas.
 * @throws McpExecutorProtocolError When a definition is malformed or a name is duplicated.
 * @see https://modelcontextprotocol.io/specification/2026-07-28
 */
export function __ParseMcpExecutorDiscoveredTools(tools: unknown): readonly McpExecutorDiscoveredTool[]
{
	const discoveredTools = _ParseDiscoveredTools(tools);
	if (discoveredTools === null)
		throw new McpExecutorProtocolError("MCP tool list was invalid");
	const names = new Set<string>();
	for (const tool of discoveredTools)
	{
		if (names.has(tool.name))
			throw new McpExecutorProtocolError("MCP tool definition was invalid");
		names.add(tool.name);
	}
	return discoveredTools;
}

/**
 * Builds one tool call after the existing ToolInvocation authority has admitted its arguments.
 *
 * @returns A JSON-RPC `tools/call` request bound to the saved invocation id.
 * @throws McpExecutorProtocolError When the invocation or tool coordinates are empty or oversized.
 * @see ToolInvocationClaim for the database claim required before this request is sent.
 * @see https://modelcontextprotocol.io/specification/2026-07-28
 */
export function __BuildMcpExecutorToolCallRequest(invocationId: string, toolName: string, argumentsValue: JsonValue): JsonValue
{
	if (invocationId.length === 0 || invocationId.length > 256 || toolName.length === 0 || toolName.length > 128)
		throw new McpExecutorProtocolError("MCP tool call coordinates were invalid");
	return { jsonrpc: "2.0", id: invocationId, method: "tools/call", params: { name: toolName, arguments: argumentsValue } };
}

/**
 * Checks one tool response and preserves an MCP tool-level error as data for the worker.
 *
 * @returns The validated MCP content blocks and tool-level error flag.
 * @throws McpExecutorProtocolError When the response does not match the invocation or MCP result shape.
 * @see ToolInvocationCompletionResult for the database outcome that later accepts this result.
 * @see https://modelcontextprotocol.io/specification/2026-07-28
 */
export function __ParseMcpExecutorToolCallResponse(payload: unknown, invocationId: string): McpExecutorToolCallResult
{
	const result = _Result(payload, invocationId);
	return __ParseMcpExecutorToolCallResult(result);
}

/** Validate the durable companion form of one MCP tool result. */
export function __ParseMcpExecutorToolCallResult(result: unknown): McpExecutorToolCallResult
{
	if (typeof result !== "object" || result === null || Array.isArray(result) || !_ExactKeys(result as Record<string, unknown>, ["isError", "content"]))
		throw new McpExecutorProtocolError("MCP tool call result was invalid");
	const value = result as Record<string, unknown>;
	const content = _McpExecutorContentBlocks(value["content"]);
	if (typeof value["isError"] !== "boolean" || content === null)
		throw new McpExecutorProtocolError("MCP tool call result was invalid");
	return { isError: value["isError"], content };
}

/** Require an object to contain exactly the named fields. */
function _ExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean
{
	const actual = Object.keys(value).sort();
	const expected = [...keys].sort();
	return actual.length === expected.length && actual.every(function _Matches(key, index) { return key === expected[index]; });
}
