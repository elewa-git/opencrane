import { z } from "zod";

import type { McpAccessPolicyCommand, McpEnabledCommand, McpInstallCommand } from "../core/mcp-operator.logic.types";
/** Accepts one complete MCP install command and rejects unknown public fields. */
export const ___McpInstallSchema: z.ZodType<McpInstallCommand> = z.object({
	serverId: z.string().trim().min(1),
}).strict();

/** Accepts the exact boolean used to publish or disable a server. */
export const ___McpEnabledSchema: z.ZodType<McpEnabledCommand> = z.object({
	enabled: z.boolean(),
}).strict();

/** Accepts only stable non-empty Group and Principal identifiers. */
export const ___McpAccessPolicySchema: z.ZodType<McpAccessPolicyCommand> = z.object({
	groupIds: z.array(z.string().trim().min(1)),
	principalIds: z.array(z.string().trim().min(1)),
}).strict();
