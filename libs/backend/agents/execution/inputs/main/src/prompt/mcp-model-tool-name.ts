import { createHash } from "node:crypto";

/** Versioned domain separator that makes the wire-name derivation an explicit compiler contract. */
const _MCP_MODEL_TOOL_NAME_DOMAIN = "opencrane-mcp-model-name-v1\0";
/** Provider name grammar shared by compiled MCP aliases and explicit first-party names. */
const _MODEL_TOOL_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u;

/** Return whether a compiled provider-facing tool name fits the closed model transport grammar. */
export function _IsModelToolNameValid(name: unknown): name is string
{
	return typeof name === "string" && _MODEL_TOOL_NAME_PATTERN.test(name);
}

/**
 * Derive the provider-facing name for one immutable MCP tool revision.
 *
 * The exact MCP name remains separate runtime evidence. This alias binds model selection to the
 * immutable revision and is safe for providers that reject punctuation or names over 64 bytes.
 */
export function _McpModelToolName(toolRevisionId: string): string
{
	if (toolRevisionId.trim().length === 0 || toolRevisionId.trim() !== toolRevisionId)
		throw new Error("MCP model tool name requires an exact non-empty revision identifier");
	const digest = createHash("sha256").update(_MCP_MODEL_TOOL_NAME_DOMAIN, "utf8").update(toolRevisionId, "utf8").digest("base64url");
	const modelName = `mcp_${digest}`;
	if (!_IsModelToolNameValid(modelName))
		throw new Error("MCP model tool name derivation produced an invalid provider name");
	return modelName;
}
