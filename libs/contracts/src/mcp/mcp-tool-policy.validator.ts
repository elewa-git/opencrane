import { z } from "zod";

import { McpToolPolicyChangeOutcomes, McpToolPolicyModes } from "./mcp-tool-policy.types";
import type { McpToolPolicyChangeCommand, McpToolPolicyChangeResult, McpToolPolicyProjection, McpToolPolicyTarget } from "./mcp-tool-policy.types";

const _MAX_POLICY_REVISION = 2_147_483_647;

/** Validates the minimal install and immutable tool-revision coordinate. */
export const ___McpToolPolicyTargetSchema: z.ZodType<McpToolPolicyTarget> = z.object({
	installId: z.string().min(1).max(256).regex(/\S/u).refine(function _HasNoSurroundingWhitespace(value): boolean { return value.trim() === value; }),
	toolRevisionId: z.string().min(1).max(256).regex(/\S/u).refine(function _HasNoSurroundingWhitespace(value): boolean { return value.trim() === value; }),
}).strict();

/** Validates an optimistic idempotent policy change without accepting authority or credential fields. */
export const ___McpToolPolicyChangeCommandSchema: z.ZodType<McpToolPolicyChangeCommand> = z.object({
	target: ___McpToolPolicyTargetSchema,
	mode: z.nativeEnum(McpToolPolicyModes),
	idempotencyKey: z.string().uuid(),
	expectedRevision: z.number().int().positive().max(_MAX_POLICY_REVISION).safe().nullable(),
}).strict();

/** Validates a projection and enforces the unique absent-policy representation. */
export const ___McpToolPolicyProjectionSchema: z.ZodType<McpToolPolicyProjection> = z.object({
	target: ___McpToolPolicyTargetSchema,
	mode: z.nativeEnum(McpToolPolicyModes),
	revision: z.number().int().positive().max(_MAX_POLICY_REVISION).safe().nullable(),
	updatedAt: z.string().datetime({ offset: true }).nullable(),
}).strict().superRefine(function _ValidatePolicyState(value, context)
{
	if (value.revision === null && (value.mode !== McpToolPolicyModes.Ask || value.updatedAt !== null))
		context.addIssue({ code: z.ZodIssueCode.custom, message: "An absent policy must be Ask with null revision and updatedAt." });
	if (value.revision !== null && value.updatedAt === null)
		context.addIssue({ code: z.ZodIssueCode.custom, message: "A saved policy revision requires updatedAt." });
});

/** Validates the flat outcome contract and requires persisted evidence only when applicable. */
export const ___McpToolPolicyChangeResultSchema: z.ZodType<McpToolPolicyChangeResult> = z.object({
	outcome: z.nativeEnum(McpToolPolicyChangeOutcomes),
	projection: ___McpToolPolicyProjectionSchema.nullable(),
}).strict().superRefine(function _ValidateResultEvidence(value, context)
{
	const requiresProjection = value.outcome === McpToolPolicyChangeOutcomes.Admitted || value.outcome === McpToolPolicyChangeOutcomes.Replayed;
	if (requiresProjection && (value.projection === null || value.projection.revision === null))
		context.addIssue({ code: z.ZodIssueCode.custom, message: "Admitted and replayed results require a saved policy revision." });
	if (!requiresProjection && value.projection !== null)
		context.addIssue({ code: z.ZodIssueCode.custom, message: "Conflict and denied results cannot claim a policy projection." });
});
