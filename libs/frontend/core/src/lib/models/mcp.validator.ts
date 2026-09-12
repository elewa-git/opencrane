import { z } from "zod";

import { McpCredentialRequirement } from "@opencrane/contracts";

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
