import type { JsonValue } from "@opencrane/util";

import { _ParseMcpContentBlocks } from "./mcp-content.validator";
import { _McpHeaderBindings } from "./mcp-header";
import { _IsMcpJsonValue, _IsMcpRecord } from "./mcp-json.validator";
import { McpProtocolError, type McpDiscoveredTool, type McpToolCallResult } from "./mcp-protocol.types";

/** Validates the strict durable projection of tool definitions. */
export function _ParseMcpDurableTools(value: unknown): readonly McpDiscoveredTool[]
{
	if (!Array.isArray(value) || value.length > 256)
		throw new McpProtocolError("MCP tool list was invalid");
	const names = new Set<string>();
	return value.map(function _Tool(candidate): McpDiscoveredTool
	{
		if (!_IsMcpRecord(candidate) || !_ExactKeys(candidate, ["name", "description", "inputSchema"]) || !_ToolName(candidate["name"]) || candidate["description"] !== null && typeof candidate["description"] !== "string" || typeof candidate["description"] === "string" && candidate["description"].length > 4_096 || !_InputSchema(candidate["inputSchema"]))
			throw new McpProtocolError("MCP tool definition was invalid");
		if (names.has(candidate["name"]))
			throw new McpProtocolError("MCP tool definition was duplicated");
		names.add(candidate["name"]);
		return { name: candidate["name"], description: candidate["description"], inputSchema: candidate["inputSchema"] };
	});
}

/** Validates and projects standard tool definitions, excluding invalid header annotations. */
export function _ProjectMcpExternalTools(value: unknown): readonly McpDiscoveredTool[]
{
	if (!Array.isArray(value) || value.length > 256)
		throw new McpProtocolError("MCP tool list was invalid");
	const tools: McpDiscoveredTool[] = [];
	const names = new Set<string>();
	for (const candidate of value)
	{
		const tool = _ProjectExternalTool(candidate);
		if (tool === null)
			continue;
		if (names.has(tool.name))
			throw new McpProtocolError("MCP tool definition was duplicated");
		names.add(tool.name);
		tools.push(tool);
	}
	return tools;
}

/** Validates the durable form after the external `resultType` field has been removed. */
export function _ParseMcpDurableToolResult(value: unknown): McpToolCallResult
{
	if (!_IsMcpRecord(value))
		throw new McpProtocolError("MCP tool call result was invalid");
	const keys = Object.hasOwn(value, "structuredContent") ? ["content", "isError", "structuredContent"] : ["content", "isError"];
	const content = _ParseMcpContentBlocks(value["content"]);
	if (!_ExactKeys(value, keys) || typeof value["isError"] !== "boolean" || content === null || Object.hasOwn(value, "structuredContent") && !_IsMcpJsonValue(value["structuredContent"]))
		throw new McpProtocolError("MCP tool call result was invalid");
	const result: McpToolCallResult = { isError: value["isError"], content };
	return Object.hasOwn(value, "structuredContent") ? { ...result, structuredContent: value["structuredContent"] as JsonValue } : result;
}

/** Projects one external tool after checking its standard optional fields. */
function _ProjectExternalTool(value: unknown): McpDiscoveredTool | null
{
	if (!_IsMcpRecord(value) || !_OnlyKeys(value, ["name", "title", "description", "inputSchema", "outputSchema", "icons", "annotations", "_meta"]) || !_ToolName(value["name"]) || value["description"] !== undefined && typeof value["description"] !== "string" || typeof value["description"] === "string" && value["description"].length > 4_096 || !_InputSchema(value["inputSchema"]))
		throw new McpProtocolError("MCP tool definition was invalid");
	if (value["title"] !== undefined && typeof value["title"] !== "string" || value["outputSchema"] !== undefined && !_IsMcpRecord(value["outputSchema"]) || value["icons"] !== undefined && !_Icons(value["icons"]) || value["annotations"] !== undefined && !_Annotations(value["annotations"]) || value["_meta"] !== undefined && (!_IsMcpRecord(value["_meta"]) || !_IsMcpJsonValue(value["_meta"])))
		throw new McpProtocolError("MCP tool metadata was invalid");
	try { _McpHeaderBindings(value["inputSchema"]); }
	catch (error)
	{
		if (error instanceof McpProtocolError)
			return null;
		throw error;
	}
	return { name: value["name"], description: typeof value["description"] === "string" ? value["description"] : null, inputSchema: value["inputSchema"] };
}

/** Checks standard display icons before they are omitted from the durable projection. */
function _Icons(value: unknown): boolean
{
	return Array.isArray(value) && value.every(function _Icon(icon): boolean
	{
		return _IsMcpRecord(icon) && _OnlyKeys(icon, ["src", "mimeType", "sizes", "theme"]) && typeof icon["src"] === "string" && icon["src"].length > 0 && (icon["mimeType"] === undefined || typeof icon["mimeType"] === "string") && (icon["sizes"] === undefined || Array.isArray(icon["sizes"]) && icon["sizes"].every(function _Size(size) { return typeof size === "string" && size.length > 0; })) && (icon["theme"] === undefined || icon["theme"] === "light" || icon["theme"] === "dark");
	});
}

/** Checks the standard advisory tool annotations without trusting added policy fields. */
function _Annotations(value: unknown): boolean
{
	if (!_IsMcpRecord(value) || !_OnlyKeys(value, ["title", "readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"]))
		return false;
	return (value["title"] === undefined || typeof value["title"] === "string") && ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"].every(function _Boolean(key) { return value[key] === undefined || typeof value[key] === "boolean"; });
}

/** Checks the outer input schema before header traversal. */
function _InputSchema(value: unknown): value is JsonValue
{
	return _IsMcpRecord(value) && value["type"] === "object" && _IsMcpJsonValue(value);
}

/** Checks a tool name without imposing stricter optional character guidance. */
function _ToolName(value: unknown): value is string
{
	return typeof value === "string" && value.length > 0 && value.length <= 128 && !/[\u0000-\u001f\u007f]/u.test(value);
}

/** Requires an object to have exactly the listed fields. */
function _ExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean
{
	return Object.keys(value).length === keys.length && keys.every(function _Has(key) { return Object.hasOwn(value, key); });
}

/** Rejects fields outside a standard external object. */
function _OnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean
{
	return Object.keys(value).every(function _Allowed(key) { return keys.includes(key); });
}
