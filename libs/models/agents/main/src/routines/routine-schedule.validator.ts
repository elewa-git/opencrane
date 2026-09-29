import { CronExpressionParser } from "cron-parser";
import { z } from "zod";

import type { RoutineSchedule } from "./routine-schedule.types";

/**
 * Keeps schedule validation beside the model so browser and backend callers accept the same shape.
 * Parsing validates calendar syntax; it never activates work or supplies a clock.
 */

/** Uses a leap year to check calendar fields without reading the current clock. */
const _VALIDATION_ANCHOR = 946_684_800_000;

/** Accepts numeric cron lists, ranges and steps, but rejects parser extensions and extra fields. */
const _NUMERIC_FIELD = /^(?:\*|\d+(?:-\d+)?)(?:\/\d+)?(?:,(?:\*|\d+(?:-\d+)?)(?:\/\d+)?)*$/u;

/** Rejects offsets and system-local defaults before `Intl` checks the named timezone. */
const _NAMED_ZONE = /^[A-Za-z][A-Za-z0-9._+-]*(?:\/[A-Za-z0-9._+-]+)*$/u;

/**
 * Accepts millisecond instants in UTC years 0001 through 9999, including epoch zero.
 *
 * Fractional, non-finite and converted string values are refused. Calendar calculations may use
 * adjacent local dates internally, but every returned instant must remain in this range.
 */
export const __RoutineEpochMsSchema = z.number().int().min(-62_135_596_800_000).max(253_402_300_799_999);

/**
 * Validates the complete schedule shape and rejects fields with no scheduling meaning.
 *
 * The pinned cron parser also rejects repeated expanded values, including both Sunday aliases in
 * one field. A timezone is normalized to the name supplied by the host's IANA data.
 */
export const __RoutineScheduleSchema: z.ZodType<RoutineSchedule> = z.object({
	expression: z.string().min(1).max(256),
	timezone: z.string().min(1).max(128),
}).strict().transform(function _normalize(value, context)
{
	const expression = value.expression.trim().split(/\s+/u).join(" ");
	const fields = expression.split(" ");
	if (fields.length !== 5 || fields.some(field => !_NUMERIC_FIELD.test(field))
		|| (expression.match(/\d+/gu) ?? []).some(number => !Number.isSafeInteger(Number(number))))
	{
		context.addIssue({ code: z.ZodIssueCode.custom, path: ["expression"], message: "Routine schedule requires five numeric cron fields" });
		return z.NEVER;
	}
	if (!_NAMED_ZONE.test(value.timezone))
	{
		context.addIssue({ code: z.ZodIssueCode.custom, path: ["timezone"], message: "Routine schedule requires a named IANA timezone" });
		return z.NEVER;
	}
	let timezone: string;
	try
	{
		timezone = new Intl.DateTimeFormat("en-US", { timeZone: value.timezone }).resolvedOptions().timeZone;
	}
	catch
	{
		context.addIssue({ code: z.ZodIssueCode.custom, path: ["timezone"], message: "Routine schedule timezone is unavailable" });
		return z.NEVER;
	}
	try
	{
		CronExpressionParser.parse(expression, { currentDate: new Date(_VALIDATION_ANCHOR), tz: "UTC", hashSeed: "routine-calendar" });
	}
	catch
	{
		context.addIssue({ code: z.ZodIssueCode.custom, path: ["expression"], message: "Routine schedule contains invalid calendar fields" });
		return z.NEVER;
	}
	return Object.freeze({ expression, timezone });
});

/**
 * Copies a schedule after checking its numeric grammar, calendar fields and named timezone.
 *
 * @param value - Untrusted schedule input.
 * @returns A normalized and frozen schedule.
 * @throws {Error} When the schedule is incomplete, extended or invalid.
 */
export function __ParseRoutineSchedule(value: unknown): RoutineSchedule
{
	return __RoutineScheduleSchema.parse(value);
}
