import { z } from "zod";

import type { McpEnabledCommand, McpInstallCommand } from "../core/mcp-operator.logic.types";
/** Accepts one complete MCP install command and rejects unknown public fields. */
export const ___McpInstallSchema: z.ZodType<McpInstallCommand> = z.object({
	serverId: z.string().trim().min(1),
}).strict();

/** Accepts the exact boolean used to publish or disable a server. */
export const ___McpEnabledSchema: z.ZodType<McpEnabledCommand> = z.object({
	enabled: z.boolean(),
}).strict();
