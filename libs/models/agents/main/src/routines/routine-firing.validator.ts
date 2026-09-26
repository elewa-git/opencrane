import { z } from "zod";

import type { RoutineFiringSelection } from "./routine-firing.types";
import { __RoutineEpochMsSchema, __RoutineScheduleSchema } from "./routine-schedule.validator";
import { RoutineFiringDisposition, RoutineFiringTrigger, RoutineStatus } from "./routine.types";

/**
 * Checks a database snapshot before pure firing selection.
 *
 * Exact fields prevent a caller from attaching grants or retry overrides and mistaking their
 * acceptance for authority. The database owner still supplies and locks the current snapshot.
 */

/** Keeps saved IDs nonblank and bounded without changing their spelling or case. */
const _Identifier = z.string().min(1).max(200).refine(function _nonblank(value) { return value.trim().length > 0; });

/** Accepts the execution stages that block a later automatic firing. */
const _UnfinishedDisposition = z.union([
	z.literal(RoutineFiringDisposition.Preparing),
	z.literal(RoutineFiringDisposition.Running),
	z.literal(RoutineFiringDisposition.Waiting),
	z.literal(RoutineFiringDisposition.Uncertain),
]);

/** Validates the complete selection snapshot and the relationship between clock and trigger. */
export const __RoutineFiringSelectionSchema: z.ZodType<RoutineFiringSelection> = z.object({
	siloId: _Identifier,
	routineId: _Identifier,
	status: z.nativeEnum(RoutineStatus),
	trigger: z.nativeEnum(RoutineFiringTrigger),
	schedule: __RoutineScheduleSchema,
	nowEpochMs: __RoutineEpochMsSchema,
	automaticEnabledAfterEpochMs: __RoutineEpochMsSchema,
	lastAutomaticOccurrenceEpochMs: __RoutineEpochMsSchema.nullable(),
	unfinishedFiringDisposition: _UnfinishedDisposition.nullable(),
	manualRequestId: _Identifier.optional(),
}).strict().superRefine(function _validateSelection(selection, context)
{
	if (selection.trigger === RoutineFiringTrigger.Manual && selection.manualRequestId === undefined)
		context.addIssue({ code: z.ZodIssueCode.custom, path: ["manualRequestId"], message: "A manual command must retain its request ID" });
	if (selection.trigger === RoutineFiringTrigger.Automatic && selection.manualRequestId !== undefined)
		context.addIssue({ code: z.ZodIssueCode.custom, path: ["manualRequestId"], message: "An automatic occurrence cannot use a manual request ID" });
	if (selection.trigger === RoutineFiringTrigger.Automatic && selection.lastAutomaticOccurrenceEpochMs !== null && selection.lastAutomaticOccurrenceEpochMs > selection.nowEpochMs)
		context.addIssue({ code: z.ZodIssueCode.custom, path: ["nowEpochMs"], message: "The database clock precedes an already consumed occurrence" });
});
