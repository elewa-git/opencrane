import { z } from "zod";

import type { McpTaskInputResponse, McpTaskSubmissionCommand } from "./mcp-task.types";

/** JSON values accepted by public task arguments and input responses. */
const _JSON: z.ZodType<unknown> = z.lazy(function _Json(): z.ZodType<unknown>
{
	return z.union([z.string(), z.number().finite(), z.boolean(), z.null(), z.array(_JSON), z.record(_JSON)]);
});

/** One bounded route coordinate. */
export const ___McpTaskIdSchema = z.string().min(1).max(256).regex(/\S/u);

/** Strict public task submission schema. */
export const ___McpTaskSubmissionSchema: z.ZodType<McpTaskSubmissionCommand> = z.object({
	idempotencyKey: z.string().min(1).max(128).regex(/\S/u),
	serverRevisionId: z.string().min(1).max(256).regex(/\S/u),
	toolRevisionId: z.string().min(1).max(256).regex(/\S/u),
	arguments: _JSON,
	inputRequest: z.object({ requestId: z.string().min(1).max(128).regex(/\S/u), message: z.string().min(1).max(4_000).regex(/\S/u), argumentName: z.string().min(1).max(256).regex(/^[A-Za-z_][A-Za-z0-9_.-]*$/u) }).strict().optional(),
}).strict() as z.ZodType<McpTaskSubmissionCommand>;

/** Strict input response schema. */
export const ___McpTaskInputResponseSchema: z.ZodType<McpTaskInputResponse> = z.object({ requestId: z.string().min(1).max(128).regex(/\S/u), value: _JSON }).strict() as z.ZodType<McpTaskInputResponse>;
