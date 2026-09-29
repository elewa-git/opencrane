import { CronExpressionParser } from "cron-parser";

import { _RoutineLatestWallClockCursor, _RoutineWallClockCursor, _RoutineWallClockInstant } from "./routine-calendar-wall-clock";
import type { RoutineSchedule } from "./routine-schedule.types";
import { __ParseRoutineSchedule, __RoutineEpochMsSchema } from "./routine-schedule.validator";

/** Bounds preview work for a creation screen without limiting routine executions. */
const _MAXIMUM_PREVIEW_COUNT = 24;

/** Stops a timezone search when every candidate keeps resolving to a missing local time. */
const _MAXIMUM_LOCAL_CANDIDATE_CHECKS = 10_000;

/**
 * Finds the first selected instant strictly after the supplied clock.
 *
 * Missing local times are skipped. A local time that happens twice occurs at its earliest UTC
 * instant and is not repeated.
 *
 * @param schedule - Numeric cron fields and the timezone in which to read them.
 * @param afterEpochMs - Exclusive lower bound supplied by the caller.
 * @returns The next UTC instant selected by the schedule.
 * @throws {Error} When the schedule, clock or calendar search is unsupported.
 */
export function __NextRoutineOccurrence(schedule: RoutineSchedule, afterEpochMs: number): number
{
	const parsed = __ParseRoutineSchedule(schedule);
	const after = __RoutineEpochMsSchema.parse(afterEpochMs);
	const cursor = _RoutineWallClockCursor(after, parsed.timezone);
	const calendar = CronExpressionParser.parse(parsed.expression, { currentDate: new Date(cursor), tz: "UTC", hashSeed: "routine-calendar" });
	for (let checked = 0; checked < _MAXIMUM_LOCAL_CANDIDATE_CHECKS; checked += 1)
	{
		const candidate = _RoutineWallClockInstant(calendar.next().getTime(), parsed.timezone);
		if (candidate !== null && candidate > after)
			return __RoutineEpochMsSchema.parse(candidate);
	}
	throw new Error("Routine calendar exceeded its local candidate search bound");
}

/**
 * Finds the latest selected instant in `(afterExclusiveEpochMs, throughInclusiveEpochMs]`.
 *
 * Reverse calendar search avoids replaying every missed occurrence. An empty or reversed interval
 * returns null.
 *
 * @param schedule - Numeric cron fields and the timezone in which to read them.
 * @param afterExclusiveEpochMs - Exclusive lower bound, normally the saved automatic cursor.
 * @param throughInclusiveEpochMs - Inclusive upper bound, supplied from the database clock.
 * @returns The latest matching UTC instant, or null when the interval contains none.
 * @throws {Error} When the schedule, clock or calendar search is unsupported.
 */
export function __LatestRoutineOccurrence(schedule: RoutineSchedule, afterExclusiveEpochMs: number, throughInclusiveEpochMs: number): number | null
{
	const parsed = __ParseRoutineSchedule(schedule);
	const after = __RoutineEpochMsSchema.parse(afterExclusiveEpochMs);
	const through = __RoutineEpochMsSchema.parse(throughInclusiveEpochMs);
	if (through <= after)
		return null;
	const cursor = _RoutineLatestWallClockCursor(through, parsed.timezone);
	const calendar = CronExpressionParser.parse(parsed.expression, { currentDate: new Date(cursor + 1), tz: "UTC", hashSeed: "routine-calendar" });
	for (let checked = 0; checked < _MAXIMUM_LOCAL_CANDIDATE_CHECKS; checked += 1)
	{
		const candidate = _RoutineWallClockInstant(calendar.prev().getTime(), parsed.timezone);
		if (candidate === null || candidate > through)
			continue;
		return candidate > after ? __RoutineEpochMsSchema.parse(candidate) : null;
	}
	throw new Error("Routine calendar exceeded its local candidate search bound");
}

/**
 * Lists up to 24 upcoming instants under the same timezone rules as firing selection.
 *
 * The caller supplies the clock and a positive count so previews cannot depend on the host clock.
 *
 * @param schedule - Numeric cron fields and the timezone in which to read them.
 * @param afterEpochMs - Exclusive lower bound supplied by the caller.
 * @param count - Number of future instants to return, from 1 through 24.
 * @returns A frozen list of UTC instants in ascending order.
 * @throws {Error} When the count, schedule, clock or calendar search is unsupported.
 */
export function __PreviewRoutineOccurrences(schedule: RoutineSchedule, afterEpochMs: number, count: number): readonly number[]
{
	if (!Number.isSafeInteger(count) || count < 1 || count > _MAXIMUM_PREVIEW_COUNT)
		throw new Error("Routine preview count must be an integer from 1 through 24");
	const parsed = __ParseRoutineSchedule(schedule);
	let cursor = __RoutineEpochMsSchema.parse(afterEpochMs);
	const occurrences: number[] = [];
	for (let index = 0; index < count; index += 1)
	{
		cursor = __NextRoutineOccurrence(parsed, cursor);
		occurrences.push(cursor);
	}
	return Object.freeze(occurrences);
}
