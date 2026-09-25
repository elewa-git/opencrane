import { describe, expect, it, vi } from "vitest";

import { __LatestRoutineOccurrence, __NextRoutineOccurrence, __PreviewRoutineOccurrences } from "../routine-calendar";
import type { RoutineSchedule } from "../routine-schedule.types";

/** Builds a schedule without a browser or database. */
function _schedule(expression: string, timezone = "UTC"): RoutineSchedule { return { expression, timezone }; }

/** Converts an explicit ISO fixture to epoch milliseconds. */
function _at(instant: string): number { return Date.parse(instant); }

describe("routine calendar bounds", function _bounds()
{
	it("keeps next exclusive, latest lower-exclusive and upper-inclusive", function _boundaries()
	{
		const schedule = _schedule("*/15 * * * *");
		const slot = _at("2026-09-25T09:15:00.000Z");
		expect(__NextRoutineOccurrence(schedule, slot - 1)).toBe(slot);
		expect(__NextRoutineOccurrence(schedule, slot)).toBe(slot + 900_000);
		expect(__LatestRoutineOccurrence(schedule, slot - 1, slot)).toBe(slot);
		expect(__LatestRoutineOccurrence(schedule, slot, slot + 899_999)).toBeNull();
		expect(__LatestRoutineOccurrence(schedule, slot, slot)).toBeNull();
		expect(__LatestRoutineOccurrence(schedule, slot + 1, slot)).toBeNull();
		const preview = __PreviewRoutineOccurrences(schedule, slot, 3);
		expect(preview).toEqual([slot + 900_000, slot + 1_800_000, slot + 2_700_000]);
		expect(Object.isFrozen(preview)).toBe(true);
	});

	it("uses epoch zero without defaulting to the host clock", function _zero()
	{
		const clock = vi.spyOn(Date, "now").mockImplementation(function _unexpected() { throw new Error("Ambient clock read"); });
		try
		{
			expect(__NextRoutineOccurrence(_schedule("* * * * *"), 0)).toBe(60_000);
			expect(__LatestRoutineOccurrence(_schedule("* * * * *"), -1, 0)).toBe(0);
			expect(__PreviewRoutineOccurrences(_schedule("0 9 * * *", "Africa/Nairobi"), 0, 1)).toEqual([21_600_000]);
		}
		finally
		{
			clock.mockRestore();
		}
	});

	it.each([0, -1, 1.5, 25, Infinity, Number.NaN])("rejects an invalid preview count %s", function _count(count)
	{
		expect(function _preview() { __PreviewRoutineOccurrences(_schedule("* * * * *"), 0, count); }).toThrow();
	});

	it.each([Number.NaN, Infinity, 0.1, -62_135_596_800_001, 253_402_300_800_000])("rejects unsupported clocks %s", function _clock(value)
	{
		expect(function _next() { __NextRoutineOccurrence(_schedule("* * * * *"), value); }).toThrow();
		expect(function _lower() { __LatestRoutineOccurrence(_schedule("* * * * *"), value, 0); }).toThrow();
		expect(function _upper() { __LatestRoutineOccurrence(_schedule("* * * * *"), 0, value); }).toThrow();
	});

	it("refuses overflow while preserving supported boundary occurrences", function _range()
	{
		const minimum = -62_135_596_800_000;
		const maximum = 253_402_300_799_999;
		expect(__NextRoutineOccurrence(_schedule("* * * * *"), minimum)).toBe(minimum + 60_000);
		expect(__LatestRoutineOccurrence(_schedule("* * * * *"), maximum - 60_000, maximum)).toBe(maximum - 59_999);
		expect(function _overflow() { __NextRoutineOccurrence(_schedule("* * * * *"), maximum); }).toThrow();
	});
});

describe("routine numeric calendar", function _numeric()
{
	it("uses Nairobi local time and calendar boundaries", function _calendar()
	{
		expect(__NextRoutineOccurrence(_schedule("0 9 * * *", "Africa/Nairobi"), _at("2026-09-25T05:59:00Z"))).toBe(_at("2026-09-25T06:00:00Z"));
		expect(__NextRoutineOccurrence(_schedule("0 0 31 * *"), _at("2026-04-01T00:00:00Z"))).toBe(_at("2026-05-31T00:00:00Z"));
		expect(__NextRoutineOccurrence(_schedule("0 0 29 2 *"), _at("2097-01-01T00:00:00Z"))).toBe(_at("2104-02-29T00:00:00Z"));
	});

	it("uses standard OR matching for restricted day and weekday fields", function _or()
	{
		const preview = __PreviewRoutineOccurrences(_schedule("0 9 1 * 1"), _at("2026-09-27T00:00:00Z"), 3);
		expect(preview).toEqual([_at("2026-09-28T09:00:00Z"), _at("2026-10-01T09:00:00Z"), _at("2026-10-05T09:00:00Z")]);
	});

	it("selects one latest slot without enumerating a long backlog", function _sparse()
	{
		expect(__LatestRoutineOccurrence(_schedule("* * * * *"), -62_135_596_800_000, _at("9999-09-25T12:34:56Z"))).toBe(_at("9999-09-25T12:34:00Z"));
		expect(__LatestRoutineOccurrence(_schedule("0 0 29 2 *"), _at("2001-01-01T00:00:00Z"), _at("9999-12-31T00:00:00Z"))).toBe(_at("9996-02-29T00:00:00Z"));
	}, 1_000);
});

describe("routine timezone transitions", function _transitions()
{
	it("skips the Brussels spring gap and uses the first autumn occurrence", function _brussels()
	{
		const schedule = _schedule("30 2 * * *", "Europe/Brussels");
		expect(__PreviewRoutineOccurrences(schedule, _at("2026-03-28T00:00:00Z"), 3)).toEqual([_at("2026-03-28T01:30:00Z"), _at("2026-03-30T00:30:00Z"), _at("2026-03-31T00:30:00Z")]);
		expect(__LatestRoutineOccurrence(schedule, _at("2026-03-28T01:30:00Z"), _at("2026-03-29T23:00:00Z"))).toBeNull();
		expect(__PreviewRoutineOccurrences(schedule, _at("2026-10-24T00:00:00Z"), 3)).toEqual([_at("2026-10-24T00:30:00Z"), _at("2026-10-25T00:30:00Z"), _at("2026-10-26T01:30:00Z")]);
		expect(__LatestRoutineOccurrence(schedule, _at("2026-10-24T00:30:00Z"), _at("2026-10-25T01:45:00Z"))).toBe(_at("2026-10-25T00:30:00Z"));
	});

	it("handles Lord Howe's thirty-minute gap and fold", function _lordHowe()
	{
		expect(__NextRoutineOccurrence(_schedule("15 2 * * *", "Australia/Lord_Howe"), _at("2026-10-03T14:00:00Z"))).toBe(_at("2026-10-04T15:15:00Z"));
		const fold = _schedule("45 1 * * *", "Australia/Lord_Howe");
		expect(__NextRoutineOccurrence(fold, _at("2026-04-04T14:00:00Z"))).toBe(_at("2026-04-04T14:45:00Z"));
		expect(__LatestRoutineOccurrence(fold, _at("2026-04-04T14:00:00Z"), _at("2026-04-04T15:20:00Z"))).toBe(_at("2026-04-04T14:45:00Z"));
	});

	it("skips Apia's missing day without moving noon into the next date", function _apia()
	{
		const schedule = _schedule("0 12 * * *", "Pacific/Apia");
		expect(__NextRoutineOccurrence(schedule, _at("2011-12-29T22:00:00Z"))).toBe(_at("2011-12-30T22:00:00Z"));
		expect(__LatestRoutineOccurrence(schedule, _at("2011-12-28T00:00:00Z"), _at("2011-12-30T12:00:00Z"))).toBe(_at("2011-12-29T22:00:00Z"));
		expect(__NextRoutineOccurrence(_schedule("* * * * *", "Pacific/Apia"), _at("2011-12-30T09:59:00Z"))).toBe(_at("2011-12-30T10:00:00Z"));
	});
});
