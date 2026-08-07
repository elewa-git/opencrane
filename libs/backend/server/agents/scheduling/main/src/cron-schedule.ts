import type { CronExpression, DueScheduledSlotsOptions, WallClock } from "./cron-schedule.types.js";

/** Millisecond length of one whole minute, the coarsest cron resolution. */
const _MINUTE_MS = 60_000;

/** Inclusive field bounds for each standard cron position, in field order. */
const _FIELD_BOUNDS = [
	{ min: 0, max: 59 },
	{ min: 0, max: 23 },
	{ min: 1, max: 31 },
	{ min: 1, max: 12 },
	{ min: 0, max: 7 },
] as const;

/**
 * Parse one comma/range/step field into the discrete integer set it matches.
 * @param field - Raw cron field text.
 * @param min - Inclusive minimum legal value.
 * @param max - Inclusive maximum legal value.
 * @returns The matched value set, or null when the field is malformed.
 */
function _parseField(field: string, min: number, max: number): Set<number> | null
{
	const values = new Set<number>();
	for (const term of field.split(","))
	{
		if (term.length === 0) return null;
		const [rangePart, stepPart] = term.split("/");
		if (term.includes("/") && (stepPart === undefined || !/^[0-9]+$/.test(stepPart))) return null;
		const step = stepPart === undefined ? 1 : Number(stepPart);
		if (step < 1) return null;
		let low = min;
		let high = max;
		if (rangePart !== "*")
		{
			const bounds = rangePart.split("-");
			if (bounds.length > 2 || bounds.some(part => !/^[0-9]+$/.test(part))) return null;
			low = Number(bounds[0]);
			high = bounds.length === 2 ? Number(bounds[1]) : (term.includes("/") ? max : low);
			if (low < min || high > max || low > high) return null;
		}
		for (let value = low; value <= high; value += step) values.add(value);
	}
	return values.size === 0 ? null : values;
}

/**
 * Parse a standard 5-field cron expression (minute hour day-of-month month day-of-week).
 *
 * Supports `*`, comma lists, `a-b` ranges, and step syntax (a leading `*` or range followed by
 * `/n`) in every field. Day-of-week
 * accepts both 0 and 7 for Sunday and is normalised to 0-6. Returns null for any malformed field so
 * a caller can fail closed rather than schedule against an ambiguous expression.
 *
 * @param expression - Raw cron text.
 * @returns The parsed expression, or null when it is not a well-formed 5-field cron.
 */
export function __ParseCronExpression(expression: string): CronExpression | null
{
	const fields = expression.trim().split(/\s+/);
	if (fields.length !== 5) return null;
	const parsed = fields.map((field, index) => _parseField(field, _FIELD_BOUNDS[index].min, _FIELD_BOUNDS[index].max));
	if (parsed.some(set => set === null)) return null;
	const [minutes, hours, daysOfMonth, months, rawDaysOfWeek] = parsed as Set<number>[];
	const daysOfWeek = new Set<number>(Array.from(rawDaysOfWeek, day => day === 7 ? 0 : day));
	return {
		minutes,
		hours,
		daysOfMonth,
		months,
		daysOfWeek,
		dayOfMonthRestricted: fields[2] !== "*",
		dayOfWeekRestricted: fields[4] !== "*",
	};
}

/** Return whether a candidate cron expression is well formed without exposing the parsed shape. */
export function __IsValidCronExpression(expression: string): boolean
{
	return __ParseCronExpression(expression) !== null;
}

/** Return whether a string names a resolvable IANA timezone. */
export function __IsValidTimezone(timezone: string): boolean
{
	try
	{
		new Intl.DateTimeFormat("en-US", { timeZone: timezone });
		return true;
	}
	catch
	{
		return false;
	}
}

/** Resolve the wall-clock components of one instant in a named IANA timezone. */
export function __WallClockInZone(date: Date, timezone: string): WallClock
{
	const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" }).formatToParts(date);
	const lookup = new Map(parts.map(part => [part.type, part.value]));
	const weekdayByLabel: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
	// Intl renders midnight as hour "24" under hour12:false in some engines; normalise it to 0.
	const hour = Number(lookup.get("hour")) % 24;
	return {
		minute: Number(lookup.get("minute")),
		hour,
		dayOfMonth: Number(lookup.get("day")),
		month: Number(lookup.get("month")),
		dayOfWeek: weekdayByLabel[lookup.get("weekday") ?? "Sun"] ?? 0,
	};
}

/**
 * Return whether a cron expression matches one wall clock, applying Vixie day-of-month/day-of-week
 * OR semantics: when both day fields are restricted the instant matches if EITHER field matches.
 */
export function __CronMatchesWallClock(expression: CronExpression, wall: WallClock): boolean
{
	if (!expression.minutes.has(wall.minute) || !expression.hours.has(wall.hour) || !expression.months.has(wall.month)) return false;
	const dayOfMonthMatches = expression.daysOfMonth.has(wall.dayOfMonth);
	const dayOfWeekMatches = expression.daysOfWeek.has(wall.dayOfWeek);
	if (expression.dayOfMonthRestricted && expression.dayOfWeekRestricted) return dayOfMonthMatches || dayOfWeekMatches;
	if (expression.dayOfMonthRestricted) return dayOfMonthMatches;
	if (expression.dayOfWeekRestricted) return dayOfWeekMatches;
	return true;
}

/**
 * Enumerate every scheduled slot due in the evaluation window, oldest first.
 *
 * The window is the minute-aligned interval `(lower, now]` where `lower` is the later of the last
 * admitted slot and `now − catchupWindow`; missed slots inside it are returned so a slow or briefly
 * suspended scheduler catches up deterministically without leader election. The result is bounded by
 * both the catch-up horizon and `maxSlots`, and each returned instant is the exact minute boundary
 * (`:00.000`) so the derived idempotency key is stable across ticks.
 *
 * @param expression - Parsed cron expression.
 * @param options - Timezone, window bounds, catch-up horizon, and slot ceiling.
 * @returns Due scheduled-slot instants as canonical ISO-8601 strings, oldest first.
 */
export function __DueScheduledSlots(expression: CronExpression, options: DueScheduledSlotsOptions): string[]
{
	const now = Date.parse(options.nowInstant);
	if (!Number.isSafeInteger(now) || !__IsValidTimezone(options.timezone) || options.catchupWindowSeconds < 0 || options.maxSlots < 1) return [];
	const catchupFloor = now - options.catchupWindowSeconds * 1_000;
	const afterMs = options.afterInstant === null ? catchupFloor : Date.parse(options.afterInstant);
	if (!Number.isSafeInteger(afterMs)) return [];
	// Exclusive lower bound is the later of the last admitted slot and the catch-up floor.
	const lowerExclusive = Math.max(afterMs, catchupFloor);
	// Iterate minute boundaries from the first whole minute strictly after the lower bound.
	const firstCandidate = Math.floor(lowerExclusive / _MINUTE_MS) * _MINUTE_MS + _MINUTE_MS;
	const slots: string[] = [];
	for (let candidate = firstCandidate; candidate <= now; candidate += _MINUTE_MS)
	{
		if (__CronMatchesWallClock(expression, __WallClockInZone(new Date(candidate), options.timezone)))
		{
			slots.push(new Date(candidate).toISOString());
			if (slots.length >= options.maxSlots) break;
		}
	}
	return slots;
}
