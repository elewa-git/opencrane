// Task inputs become durable workflow records; these validators preserve the complete input without normalizing identifiers.
import { z } from "zod";

import type { RoutineOccurrenceTaskInput, RoutineScheduleTaskInput } from "./routine-workflow.types";

/** Rejects blank or padded identifiers before they become task keys. */
const _IdentifierSchema = z.string().min(1).refine(function _IsExactIdentifier(value): boolean { return value === value.trim(); });

/** Keeps revision numbers exact when the engine stores JSON. */
const _RevisionSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

/** Accepts the complete schedule input, including a millisecond instant supported by Date. */
const _ScheduleTaskInputSchema: z.ZodType<RoutineScheduleTaskInput> = z.object({
	siloId: _IdentifierSchema,
	routineId: _IdentifierSchema,
	routineRevision: _RevisionSchema,
	slotEpochMs: z.number().int().min(-8_640_000_000_000_000).max(8_640_000_000_000_000),
}).strict();

/** Accepts the complete occurrence input without discarding unexpected fields. */
const _OccurrenceTaskInputSchema: z.ZodType<RoutineOccurrenceTaskInput> = z.object({
	siloId: _IdentifierSchema,
	firingId: _IdentifierSchema,
	routineId: _IdentifierSchema,
	routineRevision: _RevisionSchema,
}).strict();

/** Checks schedule input before its identifiers and slot become a durable task key. */
export function _ParseRoutineScheduleTaskInput(value: unknown): RoutineScheduleTaskInput
{
	const result = _ScheduleTaskInputSchema.safeParse(value);
	if (!result.success)
		throw new Error("Routine schedule task input is invalid");
	return result.data;
}

/** Checks occurrence input before it becomes a durable task record. */
export function _ParseRoutineOccurrenceTaskInput(value: unknown): RoutineOccurrenceTaskInput
{
	const result = _OccurrenceTaskInputSchema.safeParse(value);
	if (!result.success)
		throw new Error("Routine occurrence task input is invalid");
	return result.data;
}
