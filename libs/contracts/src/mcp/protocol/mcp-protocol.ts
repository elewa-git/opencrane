import type { JsonValue } from "@opencrane/util";

import { _McpHeaderBindings } from "./mcp-header";
import { _IsMcpJsonValue, _IsMcpRecord } from "./mcp-json.validator";
import { _ParseMcpDurableToolResult, _ParseMcpDurableTools, _ProjectMcpExternalTools } from "./mcp-protocol.validator";
import { McpProtocolError, type McpDiscoveryResult, type McpDiscoveredTool, type McpRequest, type McpToolCallResult, type McpToolsListResult } from "./mcp-protocol.types";

/**
 * Selects the stateless MCP revision implemented by these wire helpers.
 * @see https://modelcontextprotocol.io/specification/2026-07-28/schema — request and result fields.
 */
export const MCP_PROTOCOL_VERSION = "2026-07-28" as const;

/** Builds the stateless discovery request for a caller-selected protocol revision. */
export function ___BuildMcpDiscoveryRequest(requestId = "opencrane-mcp-discovery", protocolVersion: string = MCP_PROTOCOL_VERSION): McpRequest
{
	return _Request(requestId, "server/discover", {}, protocolVersion);
}

/** Builds one page request for the server's tool definitions. */
export function ___BuildMcpToolsListRequest(cursor?: string): McpRequest
{
	if (cursor !== undefined && (cursor.length === 0 || cursor.length > 4_096))
		throw new McpProtocolError("MCP tools cursor was invalid");
	const input: Record<string, JsonValue> = {};
	if (cursor !== undefined)
		input["cursor"] = cursor;
	return _Request("opencrane-mcp-tools", "tools/list", input, MCP_PROTOCOL_VERSION);
}

/** Builds a tool request from arguments already admitted by ToolInvocation authority. */
export function ___BuildMcpToolCallRequest(invocationId: string, toolName: string, argumentsValue: JsonValue): McpRequest
{
	if (!_Coordinate(invocationId, 256) || !_Coordinate(toolName, 128))
		throw new McpProtocolError("MCP tool call coordinates were invalid");
	return _Request(invocationId, "tools/call", { name: toolName, arguments: argumentsValue }, MCP_PROTOCOL_VERSION);
}

/** Builds the HTTP metadata required for the request and its schema-marked arguments. */
export function ___BuildMcpRequestHeaders(request: McpRequest, inputSchema?: JsonValue): Readonly<Record<string, string>>
{
	const params = _Record(request.params, "MCP request parameters were invalid");
	const meta = _Record(params["_meta"], "MCP request metadata was invalid");
	const protocolVersion = meta["io.modelcontextprotocol/protocolVersion"];
	if (typeof protocolVersion !== "string" || protocolVersion.length === 0)
		throw new McpProtocolError("MCP request protocol version was invalid");
	const headers: Record<string, string> = { Accept: "application/json, text/event-stream", "Content-Type": "application/json", "MCP-Protocol-Version": protocolVersion, "Mcp-Method": request.method };
	if (request.method !== "tools/call")
	{
		if (inputSchema !== undefined)
			throw new McpProtocolError("MCP input schema was supplied for a non-tool request");
		return headers;
	}
	const toolName = params["name"];
	const argumentsValue = params["arguments"];
	if (typeof toolName !== "string" || !_IsMcpRecord(argumentsValue) || inputSchema === undefined)
		throw new McpProtocolError("MCP tool request metadata was invalid");
	headers["Mcp-Name"] = _HeaderValue(toolName);
	for (const binding of _McpHeaderBindings(inputSchema))
	{
		const value = _PathValue(argumentsValue, binding.path);
		if (value === undefined || value === null)
			continue;
		if (binding.type === "string" && typeof value !== "string" || binding.type === "boolean" && typeof value !== "boolean" || binding.type === "integer" && (typeof value !== "number" || !Number.isSafeInteger(value)))
			throw new McpProtocolError("MCP mirrored tool argument was invalid");
		headers[`Mcp-Param-${binding.name}`] = _HeaderValue(String(value));
	}
	return headers;
}

/** Parses a completed discovery result without deciding which offered revision to use. */
export function ___ParseMcpDiscoveryResponse(payload: unknown, requestId = "opencrane-mcp-discovery"): McpDiscoveryResult
{
	const result = _Result(payload, requestId);
	const versions = result["supportedVersions"];
	if (result["resultType"] !== "complete" || !Array.isArray(versions) || versions.length === 0 || versions.some(function _Invalid(version) { return typeof version !== "string" || version.trim().length === 0 || version.length > 64; }) || !_IsMcpRecord(result["capabilities"]) || !_CacheHint(result) || result["instructions"] !== undefined && typeof result["instructions"] !== "string")
		throw new McpProtocolError("MCP discovery result was invalid");
	return result as unknown as McpDiscoveryResult;
}

/** Parses one completed page of standard tool definitions. */
export function ___ParseMcpToolsListResponse(payload: unknown): McpToolsListResult
{
	const result = _Result(payload, "opencrane-mcp-tools");
	const cursor = result["nextCursor"];
	if (result["resultType"] !== "complete" || !_CacheHint(result) || cursor !== undefined && (typeof cursor !== "string" || cursor.length === 0 || cursor.length > 4_096))
		throw new McpProtocolError("MCP tools result was invalid");
	return { tools: _ProjectMcpExternalTools(result["tools"]), nextCursor: typeof cursor === "string" ? cursor : null };
}

/** Validates tool definitions after optional external metadata has been removed. */
export function ___ParseMcpDiscoveredTools(value: unknown): readonly McpDiscoveredTool[]
{
	return _ParseMcpDurableTools(value);
}

/** Parses a complete tool result and removes its external wire discriminator. */
export function ___ParseMcpToolCallResponse(payload: unknown, invocationId: string): McpToolCallResult
{
	const result = _Result(payload, invocationId);
	if (result["resultType"] !== "complete" || result["isError"] !== undefined && typeof result["isError"] !== "boolean" || result["_meta"] !== undefined && !_IsMcpRecord(result["_meta"]))
		throw new McpProtocolError("MCP tool call did not complete");
	const durable: Record<string, unknown> = { content: result["content"], isError: result["isError"] ?? false };
	if (Object.hasOwn(result, "structuredContent"))
		durable["structuredContent"] = result["structuredContent"];
	return ___ParseMcpToolCallResult(durable);
}

/** Checks cache hints required by modern discovery and list results. */
function _CacheHint(result: Record<string, JsonValue>): boolean
{
	return typeof result["ttlMs"] === "number" && Number.isInteger(result["ttlMs"]) && result["ttlMs"] >= 0 && (result["cacheScope"] === "public" || result["cacheScope"] === "private");
}

/** Validates the strict durable form of a completed tool result. */
export function ___ParseMcpToolCallResult(value: unknown): McpToolCallResult
{
	return _ParseMcpDurableToolResult(value);
}

/** Builds a request with the two metadata entries required on every stateless call. */
function _Request(id: string, method: string, input: Readonly<Record<string, JsonValue>>, protocolVersion: string): McpRequest
{
	if (!_Coordinate(id, 256) || !_Coordinate(protocolVersion, 64))
		throw new McpProtocolError("MCP request coordinates were invalid");
	return { jsonrpc: "2.0", id, method, params: { ...input, _meta: { "io.modelcontextprotocol/protocolVersion": protocolVersion, "io.modelcontextprotocol/clientCapabilities": {} } } };
}

/** Returns a matching JSON-RPC result object and rejects error envelopes. */
function _Result(payload: unknown, expectedId: string): Record<string, JsonValue>
{
	if (!_IsMcpRecord(payload) || payload["jsonrpc"] !== "2.0" || payload["id"] !== expectedId || Object.hasOwn(payload, "error") || !_IsMcpRecord(payload["result"]) || !_IsMcpJsonValue(payload["result"]))
		throw new McpProtocolError("MCP response did not match the request");
	return payload["result"];
}

/** Reads an object field after rejecting arrays and null. */
function _Record(value: unknown, message: string): Record<string, unknown>
{
	if (!_IsMcpRecord(value))
		throw new McpProtocolError(message);
	return value;
}

/** Reads an own property along a schema-selected path. */
function _PathValue(value: Record<string, unknown>, path: readonly string[]): unknown
{
	let current: unknown = value;
	for (const segment of path)
	{
		if (!_IsMcpRecord(current) || !Object.hasOwn(current, segment))
			return undefined;
		current = current[segment];
	}
	return current;
}

/** Encodes values that cannot be carried safely as plain HTTP field values. */
function _HeaderValue(value: string): string
{
	if (/^[\x21-\x7e](?:[\x20-\x7e]*[\x21-\x7e])?$/u.test(value) && !(value.startsWith("=?base64?") && value.endsWith("?=")))
		return value;
	return `=?base64?${_Base64(new TextEncoder().encode(value))}?=`;
}

/** Encodes bytes without depending on a Node.js or browser-specific Base64 API. */
function _Base64(bytes: Uint8Array): string
{
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
	let result = "";
	for (let index = 0; index < bytes.length; index += 3)
	{
		const first = bytes[index] as number;
		const second = bytes[index + 1];
		const third = bytes[index + 2];
		const bits = first << 16 | (second ?? 0) << 8 | (third ?? 0);
		const thirdCharacter = second === undefined ? "=" : alphabet[(bits >> 6) & 63];
		const fourthCharacter = third === undefined ? "=" : alphabet[bits & 63];
		result += alphabet[(bits >> 18) & 63] + alphabet[(bits >> 12) & 63] + thirdCharacter + fourthCharacter;
	}
	return result;
}

/** Checks a non-empty string coordinate without control characters. */
function _Coordinate(value: string, maximumLength: number): boolean
{
	return value.length > 0 && value.length <= maximumLength && !/[\u0000-\u001f\u007f]/u.test(value);
}
