import { describe, expect, it, vi } from "vitest";

import { __ParseRoutineSchedule, __RoutineEpochMsSchema, __RoutineScheduleSchema } from "../routine-schedule.validator";

describe("routine schedule validation", function _suite()
{
	it("copies and freezes numeric cron fields with normalized whitespace and timezone", function _copy()
	{
		const input = { expression: "  */15\t9-17  *  *  1-5 \n", timezone: "europe/brussels" };
		const parsed = __ParseRoutineSchedule(input);
		expect(parsed).toEqual({ expression: "*/15 9-17 * * 1-5", timezone: "Europe/Brussels" });
		expect(parsed).not.toBe(input);
		expect(Object.isFrozen(parsed)).toBe(true);
	});

	it.each([
		null, [], {}, { expression: "* * * * *" }, { expression: "* * * * *", timezone: "UTC", enabled: true },
		{ expression: 15, timezone: "UTC" }, { expression: "* * * * *", timezone: 3 },
	])("rejects an incomplete, extended or nonnumeric shape: %j", function _shape(value)
	{
		expect(__RoutineScheduleSchema.safeParse(value).success).toBe(false);
	});

	it.each([
		"", " ", "* * * *", "0 * * * * *", "@daily", "H * * * *", "0 0 L * *", "0 0 * * 1#2", "0 0 ? * *",
		"0 0 * JAN MON", "1.5 * * * *", "+1 * * * *", "1e1 * * * *", "1--2 * * * *", "1,,2 * * * *",
		"1/0 * * * *", "*/0 * * * *", "60 * * * *", "0 24 * * *", "0 0 0 * *", "0 0 * 13 *", "0 0 * * 8",
		"0 0 30 2 *", "0 0 31 4 *", "0 0 32 * *", "*/9007199254740993 * * * *", "1-0 * * * *",
		"0,0 * * * *", "0 0 * * 0,7", `${" ".repeat(257)}* * * * *`,
	])("rejects invalid numeric grammar or an impossible date: %s", function _expression(expression)
	{
		expect(function _parse() { __ParseRoutineSchedule({ expression, timezone: "UTC" }); }).toThrow();
	});

	it.each(["", "Not/A_Zone", "+03:00", "UTC+3", "local", " Africa/Nairobi", "A".repeat(129)])("rejects an unavailable or non-IANA zone: %s", function _zone(timezone)
	{
		expect(function _parse() { __ParseRoutineSchedule({ expression: "0 9 * * *", timezone }); }).toThrow();
	});

	it.each(["0 0 29 2 *", "0 9 1 * 1", "0 0 30 2 1", "0,15,30,45 0-23/2 * 1,3,5 0,6", "0 0 * * 7"])("accepts numeric lists and standard day/weekday OR matching: %s", function _valid(expression)
	{
		expect(__ParseRoutineSchedule({ expression, timezone: "Africa/Nairobi" }).expression).toBe(expression);
	});

	it("validates from an explicit anchor without reading the current clock", function _explicitClock()
	{
		const clock = vi.spyOn(Date, "now").mockImplementation(function _unexpected() { throw new Error("Ambient clock read"); });
		try
		{
			expect(__ParseRoutineSchedule({ expression: "0 0 29 2 *", timezone: "UTC" })).toBeDefined();
		}
		finally
		{
			clock.mockRestore();
		}
	});

	it.each([-62_135_596_800_000, 0, 253_402_300_799_999])("accepts the supported epoch boundary %s", function _epoch(epoch)
	{
		expect(__RoutineEpochMsSchema.parse(epoch)).toBe(epoch);
	});

	it.each([-62_135_596_800_001, 253_402_300_800_000, Number.NaN, Infinity, -Infinity, 0.5, "0", new Date(0), null])("rejects an unsupported clock %s", function _invalidEpoch(epoch)
	{
		expect(__RoutineEpochMsSchema.safeParse(epoch).success).toBe(false);
	});
});
