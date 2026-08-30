/**
 * Validates controller assignment JSON before the MCP gateway treats it as a workload binding.
 * The router receives an untrusted HTTP body, so this schema stays beside the binding model and
 * admits no controller-selected silo, image, or workload class field.
 */
import { z } from "zod";

import type { RuntimeWorkloadBinding } from "@opencrane/backend/agents/runtime/workloads/contract";

/** Rejects empty or control-character coordinates before they become durable controller fences. */
const _CoordinateSchema = z.string().min(1).max(256).regex(/^[^\u0000-\u001f\u007f]+$/u);

/** Accepts only database instants serialized with millisecond UTC precision. */
const _InstantSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u).refine(function _ValidInstant(value): boolean { return Number.isFinite(Date.parse(value)); });

/** Validates controller assignment evidence without permitting a controller to select its silo or image. */
const _AssignmentSchema = z.object({
	claimId: _CoordinateSchema,
	claimedAt: _InstantSchema,
	deliveryCount: z.number().int().positive(),
	profileName: _CoordinateSchema.max(128),
	workloadUid: _CoordinateSchema,
}).strict();

/** Parses one exact assignment body before the router binds it to the claim ID in its path. */
export function _ParseMcpRuntimeAssignment(value: unknown): RuntimeWorkloadBinding
{
	const result = _AssignmentSchema.safeParse(value);
	if (!result.success)
		throw new Error("MCP runtime assignment has an invalid shape");
	return result.data;
}

/** Validates the route claim coordinate before correlating it with assignment evidence. */
export function _ParseMcpRuntimeClaimId(value: string): string
{
	const result = _CoordinateSchema.safeParse(value);
	if (!result.success)
		throw new Error("MCP runtime assignment has an invalid shape");
	return result.data;
}
