import { z } from "zod";

import type { McpRemoteServerRegistrationCommand } from "./mcp-era-probe.types";

/** Validate and normalize the public fields that can become a remote MCP registration. */
export const ___McpRemoteServerRegistrationSchema: z.ZodType<McpRemoteServerRegistrationCommand> = z.object({
	idempotencyKey: z.string().trim().min(8).max(128),
	name: z.string().trim().min(1).max(120),
	description: z.string().trim().max(1_000).optional(),
	endpoint: z.string().trim().url().max(2_048),
}).strict();
