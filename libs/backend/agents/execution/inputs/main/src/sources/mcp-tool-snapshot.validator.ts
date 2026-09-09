import { Ajv } from "ajv";

import type { RunInputSnapshotMcpTool } from "@opencrane/contracts";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

/** Shared schema compiler used only to verify immutable discovered MCP tool inputs. */
const _AJV = new Ajv({ allErrors: true, strict: false });

/** Returns whether a value is a non-array JSON object. */
function _isObject(value: unknown): value is { readonly [key: string]: JsonValue }
{
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Verifies one exact MCP tool revision snapshot before it reaches a model or approval. */
export function __IsRunInputSnapshotMcpToolValid(tool: RunInputSnapshotMcpTool): boolean
{
	if (typeof tool?.toolRevisionId !== "string" || tool.toolRevisionId.trim().length === 0)
		return false;
	if (typeof tool.name !== "string" || tool.name.trim().length === 0)
		return false;
	if (tool.description !== null && typeof tool.description !== "string")
		return false;
	if (!_isObject(tool.inputSchema) || tool.inputSchema["type"] !== "object")
		return false;
	if (typeof tool.inputSchemaDigest !== "string" || ___DigestCanonicalJson(tool.inputSchema) !== tool.inputSchemaDigest)
		return false;
	try
	{
		return _AJV.validateSchema(tool.inputSchema as object) && Boolean(_AJV.compile(tool.inputSchema as object));
	}
	catch
	{
		return false;
	}
}

/** Verifies a complete exact MCP tool revision set and rejects ambiguous ids or model-visible names. */
export function __AreRunInputSnapshotMcpToolsValid(tools: readonly RunInputSnapshotMcpTool[]): boolean
{
	return tools.every(__IsRunInputSnapshotMcpToolValid)
		&& new Set(tools.map(function _RevisionId(tool): string { return tool.toolRevisionId; })).size === tools.length
		&& new Set(tools.map(function _Name(tool): string { return tool.name; })).size === tools.length;
}
