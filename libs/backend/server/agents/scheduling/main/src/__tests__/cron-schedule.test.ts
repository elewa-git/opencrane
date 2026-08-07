import { describe, expect, it } from "vitest";

import { __CronMatchesWallClock, __DueScheduledSlots, __IsValidCronExpression, __IsValidTimezone, __ParseCronExpression, __WallClockInZone } from "../cron-schedule.js";

describe("cron expression parsing", function _ParseSuite()
{
	it("accepts wildcards, lists, ranges, and steps", function _AcceptsWellFormed()
	{
		expect(__IsValidCronExpression("*/5 * * * *")).toBe(true);
		expect(__IsValidCronExpression("0 9-17 * * 1-5")).toBe(true);
		expect(__IsValidCronExpression("0,30 0 1 1 *")).toBe(true);
		const parsed = __ParseCronExpression("15 3 * * 0");
		expect(parsed?.minutes.has(15)).toBe(true);
		expect(parsed?.hours.has(3)).toBe(true);
		expect(parsed?.daysOfWeek.has(0)).toBe(true);
		expect(parsed?.dayOfWeekRestricted).toBe(true);
		expect(parsed?.dayOfMonthRestricted).toBe(false);
	});

	it("normalises Sunday-as-7 to 0", function _NormalisesSunday()
	{
		expect(__ParseCronExpression("0 0 * * 7")?.daysOfWeek.has(0)).toBe(true);
	});

	it("rejects malformed expressions", function _RejectsMalformed()
	{
		expect(__ParseCronExpression("* * * *")).toBeNull();
		expect(__ParseCronExpression("60 * * * *")).toBeNull();
		expect(__ParseCronExpression("* 24 * * *")).toBeNull();
		expect(__ParseCronExpression("* * * * 8")).toBeNull();
		expect(__ParseCronExpression("*/0 * * * *")).toBeNull();
		expect(__ParseCronExpression("5-1 * * * *")).toBeNull();
	});
});

describe("Vixie day-of-month/day-of-week OR semantics", function _OrSuite()
{
	it("matches either day field when both are restricted", function _OrOfDays()
	{
		const expr = __ParseCronExpression("0 0 13 * 5"); // 13th OR any Friday
		expect(__CronMatchesWallClock(expr!, { minute: 0, hour: 0, dayOfMonth: 13, month: 6, dayOfWeek: 3 })).toBe(true);
		expect(__CronMatchesWallClock(expr!, { minute: 0, hour: 0, dayOfMonth: 20, month: 6, dayOfWeek: 5 })).toBe(true);
		expect(__CronMatchesWallClock(expr!, { minute: 0, hour: 0, dayOfMonth: 20, month: 6, dayOfWeek: 3 })).toBe(false);
	});
});

describe("timezone wall-clock resolution", function _ZoneSuite()
{
	it("resolves the local wall clock, honouring the offset", function _ResolvesLocal()
	{
		// 2026-07-01T12:00Z is 08:00 in New York (EDT, UTC-4).
		const wall = __WallClockInZone(new Date("2026-07-01T12:00:00.000Z"), "America/New_York");
		expect(wall.hour).toBe(8);
		expect(wall.dayOfMonth).toBe(1);
		expect(wall.month).toBe(7);
	});

	it("validates IANA zones", function _ValidatesZone()
	{
		expect(__IsValidTimezone("Europe/Brussels")).toBe(true);
		expect(__IsValidTimezone("Not/AZone")).toBe(false);
	});
});

describe("due scheduled slots and catch-up", function _DueSuite()
{
	it("enumerates every missed hourly slot within the catch-up window, oldest first", function _CatchUp()
	{
		// Last fired at 00:00Z, now is 03:30Z: hourly slots 01:00, 02:00, 03:00 were missed.
		const slots = __DueScheduledSlots(__ParseCronExpression("0 * * * *")!, {
			timezone: "UTC",
			afterInstant: "2026-07-01T00:00:00.000Z",
			nowInstant: "2026-07-01T03:30:00.000Z",
			catchupWindowSeconds: 86_400,
			maxSlots: 100,
		});
		expect(slots).toEqual(["2026-07-01T01:00:00.000Z", "2026-07-01T02:00:00.000Z", "2026-07-01T03:00:00.000Z"]);
	});

	it("caps catch-up by the bounded window", function _WindowFloor()
	{
		// Only the last hour is inside a 1-hour catch-up window even though the cursor is far behind.
		const slots = __DueScheduledSlots(__ParseCronExpression("0 * * * *")!, {
			timezone: "UTC",
			afterInstant: "2026-07-01T00:00:00.000Z",
			nowInstant: "2026-07-01T05:30:00.000Z",
			catchupWindowSeconds: 3_600,
			maxSlots: 100,
		});
		expect(slots).toEqual(["2026-07-01T05:00:00.000Z"]);
	});

	it("caps the number of slots returned", function _SlotCeiling()
	{
		const slots = __DueScheduledSlots(__ParseCronExpression("* * * * *")!, {
			timezone: "UTC",
			afterInstant: "2026-07-01T00:00:00.000Z",
			nowInstant: "2026-07-01T00:10:00.000Z",
			catchupWindowSeconds: 86_400,
			maxSlots: 3,
		});
		expect(slots).toHaveLength(3);
		expect(slots[0]).toBe("2026-07-01T00:01:00.000Z");
	});

	it("evaluates the cron in its timezone, not UTC", function _ZoneAware()
	{
		// 09:00 New York on 2026-07-01 (EDT) is 13:00Z.
		const slots = __DueScheduledSlots(__ParseCronExpression("0 9 * * *")!, {
			timezone: "America/New_York",
			afterInstant: "2026-07-01T00:00:00.000Z",
			nowInstant: "2026-07-01T23:59:00.000Z",
			catchupWindowSeconds: 86_400,
			maxSlots: 100,
		});
		expect(slots).toEqual(["2026-07-01T13:00:00.000Z"]);
	});
});
