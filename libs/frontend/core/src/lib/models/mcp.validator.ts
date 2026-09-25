import { z } from "zod";

import { McpConnectionFailureCodes, McpConnectionStatus, McpCredentialRequirement } from "@opencrane/contracts";

import type { McpConnectionProjection } from "./mcp.types";

/** Validate an untrusted catalogue value before it becomes browser MCP state. */
const _MCP_CREDENTIAL_REQUIREMENT: z.ZodType<McpCredentialRequirement> = z.nativeEnum(McpCredentialRequirement);

/** Reject missing or unknown credential requirements without exposing response data. */
export function _ParseMcpCredentialRequirement(value: unknown): McpCredentialRequirement
{
	const result = _MCP_CREDENTIAL_REQUIREMENT.safeParse(value);
	if (!result.success)
		throw new Error("MCP credential requirement is invalid.");
	return result.data;
}

/** Connection responses may enter browser state only through this credential-free projection. */
const _MCP_CONNECTION_PROJECTION: z.ZodType<McpConnectionProjection> = z.object({
	connectionStatus: z.nativeEnum(McpConnectionStatus),
	connectionGeneration: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable(),
	credentialUpdatedAt: z.string().datetime({ offset: true }).nullable(),
	failureCode: z.nativeEnum(McpConnectionFailureCodes).nullable(),
}).strict();

/** Reject unknown response fields and malformed states without returning the untrusted data. */
export function _ParseMcpConnectionProjection(value: unknown): McpConnectionProjection
{
	const result = _MCP_CONNECTION_PROJECTION.safeParse(value);
	if (!result.success)
		throw new Error("MCP connection response is invalid.");
	return result.data;
}
