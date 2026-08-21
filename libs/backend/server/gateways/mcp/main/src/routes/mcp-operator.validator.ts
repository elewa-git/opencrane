import { z } from "zod";

import type { McpAccessPolicyCommand, McpCredentialCommand, McpEnabledCommand, McpInstallCommand } from "../core/mcp-operator.logic.types";

/** Accepts one complete MCP install command and rejects unknown public fields. */
export const ___McpInstallSchema: z.ZodType<McpInstallCommand> = z.object({
	serverId: z.string().trim().min(1),
}).strict();

/** Accepts a non-empty write-only map of non-empty credential values. */
export const ___McpCredentialSchema: z.ZodType<McpCredentialCommand> = z.object({
	values: z.record(z.string().trim().min(1), z.string().min(1)).refine(values => Object.keys(values).length > 0),
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
