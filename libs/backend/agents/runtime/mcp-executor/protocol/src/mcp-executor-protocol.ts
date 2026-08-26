import type { JsonValue } from "@opencrane/util";

import { McpExecutorProtocolError, type McpExecutorDiscoveredTool, type McpExecutorToolCallResult } from "./mcp-executor-protocol.types";
import { _IsMcpExecutorToolInputSchema, _McpExecutorContentBlocks } from "./mcp-executor-protocol.validator";

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

/** Validate the durable companion form of one discovered MCP tool list. */
export function __ParseMcpExecutorDiscoveredTools(tools: unknown): readonly McpExecutorDiscoveredTool[]
{
	if (!Array.isArray(tools) || tools.length > 256)
		throw new McpExecutorProtocolError("MCP tool list was invalid");
	const names = new Set<string>();
	return tools.map(function _Tool(value): McpExecutorDiscoveredTool
	{
		if (typeof value !== "object" || value === null || Array.isArray(value))
			throw new McpExecutorProtocolError("MCP tool definition was invalid");
		const tool = value as Record<string, unknown>;
		const name = tool["name"];
		const description = tool["description"];
		if (!_AllowedKeys(tool, ["name", "description", "inputSchema"]) || !Object.hasOwn(tool, "name") || !Object.hasOwn(tool, "inputSchema") || typeof name !== "string" || name.length === 0 || name.length > 128 || names.has(name) || (description !== undefined && description !== null && (typeof description !== "string" || description.length > 4_096)) || !_IsMcpExecutorToolInputSchema(tool["inputSchema"]))
			throw new McpExecutorProtocolError("MCP tool definition was invalid");
		names.add(name);
		return { name, description: typeof description === "string" ? description : null, inputSchema: tool["inputSchema"] };
	});
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

/** Refuse unknown fields while allowing documented optional fields to be absent. */
function _AllowedKeys(value: Record<string, unknown>, keys: readonly string[]): boolean
{
	return Object.keys(value).every(function _Allowed(key) { return keys.includes(key); });
}
