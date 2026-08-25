import { z } from "zod";

/** Public route-parameter schema for one MCP bundle validation identifier. */
export const ___McpbValidationIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u);

/** Public request schema for one MCP bundle validation submission. */
export const ___McpbValidationSubmissionSchema = z.object({
	idempotencyKey: z.string().trim().min(1).max(128),
	artifactId: ___McpbValidationIdSchema,
	artifactRevisionId: ___McpbValidationIdSchema,
}).strict();
