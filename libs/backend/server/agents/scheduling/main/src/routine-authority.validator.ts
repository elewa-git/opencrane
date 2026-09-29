// Command receipts cross a JSON storage boundary, so these validators must change with the result models they restore.
import { z } from "zod";

import { RoutineFiringDisposition, RoutineFiringTrigger, RoutineStatus } from "@opencrane/models/agents";

import { RoutineCommandOutcome, type RoutineCommandResult, type RoutineFiringResult } from "./routine-authority.types";

/** Accepts a nonblank saved identifier without changing the stored value. */
const _IdentifierSchema = z.string().refine(function _IsIdentifier(value): boolean { return value.trim().length > 0; });

/** Accepts the canonical UTC instant produced by `Date.toISOString()`. */
const _InstantSchema = z.string().refine(function _IsCanonicalInstant(value): boolean
{
	const parsed = new Date(value);
	return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
});

/** Accepts a positive revision that remains exact in JSON and JavaScript. */
const _RevisionSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

/** Validates the complete saved definition result and rejects impossible lifecycle combinations. */
export const _RoutineCommandResultSchema: z.ZodType<RoutineCommandResult> = z.object({
	outcome: z.nativeEnum(RoutineCommandOutcome),
	routineId: _IdentifierSchema,
	currentRevision: _RevisionSchema,
	status: z.nativeEnum(RoutineStatus),
	lifecycleRevision: _RevisionSchema,
	nextAutomaticOccurrence: _InstantSchema.nullable(),
}).strict().superRefine(function _ValidDefinitionResult(result, context): void
{
	if (result.outcome !== RoutineCommandOutcome.Committed)
	{
		context.addIssue({ code: z.ZodIssueCode.custom, path: ["outcome"], message: "routine definition commands must commit" });
	}
	const automaticActive = result.status === RoutineStatus.Active;
	if (automaticActive !== (result.nextAutomaticOccurrence !== null))
	{
		context.addIssue({ code: z.ZodIssueCode.custom, path: ["nextAutomaticOccurrence"], message: "routine definition result has an inconsistent automatic slot" });
	}
});

/** Validates the complete saved occurrence result and rejects impossible trigger and outcome combinations. */
export const _RoutineFiringResultSchema: z.ZodType<RoutineFiringResult> = z.object({
	outcome: z.nativeEnum(RoutineCommandOutcome),
	firingId: _IdentifierSchema,
	routineId: _IdentifierSchema,
	routineRevision: _RevisionSchema,
	trigger: z.nativeEnum(RoutineFiringTrigger),
	disposition: z.nativeEnum(RoutineFiringDisposition),
	conversationId: _IdentifierSchema,
	scheduledSlot: _InstantSchema.nullable(),
	reason: z.string().min(1).nullable(),
}).strict().superRefine(function _ValidFiringResult(result, context): void
{
	const automatic = result.trigger === RoutineFiringTrigger.Automatic;
	if (automatic !== (result.scheduledSlot !== null))
	{
		context.addIssue({ code: z.ZodIssueCode.custom, path: ["scheduledSlot"], message: "routine firing trigger does not match its schedule slot" });
	}
	const refused = result.disposition === RoutineFiringDisposition.Refused;
	if (refused !== (result.outcome === RoutineCommandOutcome.Refused))
	{
		context.addIssue({ code: z.ZodIssueCode.custom, path: ["outcome"], message: "routine firing refusal does not match its command outcome" });
	}
	const overlap = result.disposition === RoutineFiringDisposition.SkippedOverlap;
	if (overlap && !automatic)
	{
		context.addIssue({ code: z.ZodIssueCode.custom, path: ["disposition"], message: "only an automatic firing may skip overlap" });
	}
	if ((refused || overlap) !== (result.reason !== null))
	{
		context.addIssue({ code: z.ZodIssueCode.custom, path: ["reason"], message: "routine firing reason does not match its disposition" });
	}
});

/** Restores one command result without converting or dropping saved evidence. */
export function _ParseRoutineCommandResult(value: unknown, receipt: { readonly routineId: string; readonly routineRevision: number | null; readonly firingId: string | null }): RoutineCommandResult
{
	const parsed = _RoutineCommandResultSchema.safeParse(value);
	if (!parsed.success || parsed.data.routineId !== receipt.routineId || parsed.data.currentRevision !== receipt.routineRevision || receipt.firingId !== null)
	{
		throw new Error("routine command receipt result is invalid");
	}
	return parsed.data;
}

/** Restores a saved Run now result; an automatic firing cannot be evidence of this human command. */
export function _ParseRoutineFiringResult(value: unknown, receipt: { readonly routineId: string; readonly routineRevision: number | null; readonly firingId: string | null }): RoutineFiringResult
{
	const parsed = _RoutineFiringResultSchema.safeParse(value);
	if (!parsed.success || parsed.data.trigger !== RoutineFiringTrigger.Manual || parsed.data.routineId !== receipt.routineId || parsed.data.routineRevision !== receipt.routineRevision || parsed.data.firingId !== receipt.firingId)
	{
		throw new Error("routine firing receipt result is invalid");
	}
	return parsed.data;
}
