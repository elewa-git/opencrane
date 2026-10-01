import { z } from "zod";

import type { McpConnectionMaterialVerifierKeyringConfig } from "./mcp-connection-material-verifier.types";

/** Validates the dedicated server-side MCP material keyring document. */
export const ___McpConnectionMaterialVerifierKeyringSchema: z.ZodType<McpConnectionMaterialVerifierKeyringConfig> = z.object({
	currentKeyId: z.string().min(1).max(64).regex(/^[A-Za-z0-9._-]+$/u),
	keys: z.array(z.object({
		id: z.string().min(1).max(64).regex(/^[A-Za-z0-9._-]+$/u),
		secretBase64: z.string().min(44).max(176).regex(/^[A-Za-z0-9+/]+={0,2}$/u),
	}).strict()).min(1).max(8),
}).strict().superRefine(function _UniqueAndCurrent(value, context)
{
	const ids = value.keys.map(key => key.id);
	if (new Set(ids).size !== ids.length)
		context.addIssue({ code: z.ZodIssueCode.custom, message: "MCP material key identifiers must be unique.", path: ["keys"] });
	if (!ids.includes(value.currentKeyId))
		context.addIssue({ code: z.ZodIssueCode.custom, message: "The current MCP material key must exist in the keyring.", path: ["currentKeyId"] });
});
