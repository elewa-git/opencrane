/**
 * Validates MCP route JSON before the gateway treats it as product input or controller evidence.
 * The strict schemas reject unknown fields, while the public wire functions retain correlation and
 * error-message ownership for each route.
 */
import { z } from "zod";

import type { RuntimeWorkloadBinding } from "@opencrane/backend/agents/runtime/workloads/contract";

import type { McpOciServerPromotionCommand, McpRuntimeCleanupCommand, McpRuntimePodRegistrationCommand, McpRuntimeReleaseCommand } from "./mcp-runtime.types";

/** Rejects empty coordinates and control characters before values become database fences. */
const _CoordinateSchema = z.string().min(1).max(256).regex(/^[^\u0000-\u001f\u007f]+$/u);

/** Accepts database instants serialized with millisecond UTC precision. */
const _InstantSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u).refine(function _ValidInstant(value): boolean { return Number.isFinite(Date.parse(value)); });

/** Accepts a name after rejecting control characters and trimming ordinary whitespace. */
const _PromotionNameSchema = z.string().refine(function _NoControlCharacters(value): boolean { return !/[\u0000-\u001f\u007f]/u.test(value); }).transform(function _Trim(value): string { return value.trim(); }).pipe(z.string().min(1).max(120));

/** Accepts a description after rejecting control characters and trimming ordinary whitespace. */
const _PromotionDescriptionSchema = z.string().refine(function _NoControlCharacters(value): boolean { return !/[\u0000-\u001f\u007f]/u.test(value); }).transform(function _Trim(value): string { return value.trim(); }).pipe(z.string().max(1_000));

/** Validates the administrator-owned fields accepted by OCI server promotion. */
const _PromotionSchema = z.object({
	name: _PromotionNameSchema,
	description: _PromotionDescriptionSchema,
}).strict();

/** Validates controller assignment evidence without accepting a silo, image, or workload class. */
const _AssignmentSchema = z.object({
	claimId: _CoordinateSchema,
	claimedAt: _InstantSchema,
	deliveryCount: z.number().int().positive(),
	profileName: _CoordinateSchema.max(128),
	workloadUid: _CoordinateSchema,
}).strict();

/** Validates the fence that proves which assigned Job was released. */
const _ReleaseSchema = z.object({
	releaseClaimedAt: _InstantSchema,
	releaseDeliveryCount: z.number().int().positive(),
	workloadUid: _CoordinateSchema,
}).strict();

/** Validates first-Pod evidence under the same release fence. */
const _PodRegistrationSchema = _ReleaseSchema.extend({
	podUid: _CoordinateSchema.max(128),
}).strict();

/** Validates the fence that proves which terminal Job was deleted. */
const _CleanupSchema = z.object({
	cleanupClaimedAt: _InstantSchema,
	cleanupDeliveryCount: z.number().int().positive(),
	workloadUid: _CoordinateSchema,
}).strict();

/** Parses the exact administrator fields accepted by OCI server promotion. */
export function _ParseMcpOciServerPromotionCommand(value: unknown): McpOciServerPromotionCommand
{
	const result = _PromotionSchema.safeParse(value);
	if (!result.success)
		throw new Error("MCP OCI server promotion has an invalid shape");
	return result.data;
}

/** Parses an assignment body before the router binds it to the route claim ID. */
export function _ParseMcpRuntimeAssignment(value: unknown): RuntimeWorkloadBinding
{
	const result = _AssignmentSchema.safeParse(value);
	if (!result.success)
		throw new Error("MCP runtime assignment has an invalid shape");
	return result.data;
}

/** Parses the route claim coordinate before it is correlated with assignment evidence. */
export function _ParseMcpRuntimeClaimId(value: string): string
{
	const result = _CoordinateSchema.safeParse(value);
	if (!result.success)
		throw new Error("MCP runtime assignment has an invalid shape");
	return result.data;
}

/** Parses a release command without accepting any server-owned field. */
export function _ParseMcpRuntimeReleaseCommand(value: unknown): McpRuntimeReleaseCommand
{
	const result = _ReleaseSchema.safeParse(value);
	if (!result.success)
		throw new Error("MCP runtime release has an invalid shape");
	return result.data;
}

/** Parses first-Pod evidence under its release-delivery fence. */
export function _ParseMcpRuntimePodRegistrationCommand(value: unknown): McpRuntimePodRegistrationCommand
{
	const result = _PodRegistrationSchema.safeParse(value);
	if (!result.success)
		throw new Error("MCP runtime Pod registration has an invalid shape");
	return result.data;
}

/** Parses a cleanup command without accepting any server-owned field. */
export function _ParseMcpRuntimeCleanupCommand(value: unknown): McpRuntimeCleanupCommand
{
	const result = _CleanupSchema.safeParse(value);
	if (!result.success)
		throw new Error("MCP runtime cleanup has an invalid shape");
	return result.data;
}
