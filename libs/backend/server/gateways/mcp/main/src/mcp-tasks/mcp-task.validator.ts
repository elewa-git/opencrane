import { z } from "zod";
import type { JsonValue } from "@opencrane/util";

import type { McpTaskInputResponse, McpTaskSubmissionCommand } from "./mcp-task.types";

/** Builds the strict public task shape before the transform returns the lifecycle command. */
const _McpTaskSubmissionSchema = z.object({
	idempotencyKey: z.string().trim().min(1).max(128),
	toolName: z.string().trim().min(1).max(256),
	arguments: z.unknown(),
	inputRequest: z.object({
		requestId: z.string().trim().min(1).max(128),
		message: z.string().trim().min(1).max(4_000),
	}).strict(),
}).strict().refine(function _RequiresArguments(value): boolean
{
	return Object.hasOwn(value, "arguments");
}, "arguments is required");

/** Validates the public task commands next to the lifecycle types they create. */
export const ___McpTaskSubmissionSchema: z.ZodType<McpTaskSubmissionCommand, z.ZodTypeDef, unknown> = _McpTaskSubmissionSchema.transform(function _TaskSubmission(value): McpTaskSubmissionCommand
{
  return { idempotencyKey: value.idempotencyKey, toolName: value.toolName, arguments: value.arguments as JsonValue, inputRequest: value.inputRequest };
});

/** Validates the saved response that wakes a task waiting for client input. */
export const ___McpTaskInputResponseSchema: z.ZodType<McpTaskInputResponse> = z.object({
	requestId: z.string().trim().min(1).max(128),
	value: z.string().trim().min(1).max(16_000),
}).strict();

/** Accepts the opaque task identifier produced by a successful task submission. */
export const ___McpTaskIdSchema = z.string().trim().min(1).max(256);
