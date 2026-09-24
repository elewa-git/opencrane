import { z } from "zod";

import { McpConnectionCredentialKinds, type McpConnectionCommand } from "@opencrane/contracts";

/** Bound one route identifier before it reaches authorization or persistence. */
export const ___McpConnectionIdentifierSchema = z.string().min(1).max(256);

/** Strict write-only command accepted by MCP connection routes. */
export const ___McpConnectionCommandSchema: z.ZodType<McpConnectionCommand> = z.object({
	idempotencyKey: z.string().trim().min(8).max(128),
	expectedGeneration: z.number().int().positive().safe().nullable(),
	credential: z.discriminatedUnion("kind", [
		z.object({ kind: z.literal(McpConnectionCredentialKinds.None) }).strict(),
		z.object({ kind: z.literal(McpConnectionCredentialKinds.Bearer), token: z.string().min(1).max(8_192) }).strict(),
	]),
}).strict();

/** Strict query accepted by MCP connection revocation routes. */
export const ___McpConnectionRevocationSchema = z.object({
	commandId: z.string().trim().min(8).max(128),
	expectedGeneration: z.preprocess(value => typeof value === "string" && /^[1-9][0-9]*$/.test(value) ? Number(value) : value, z.number().int().positive().safe()),
}).strict();
