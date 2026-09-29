import { describe, expect, it, vi } from "vitest";

import { RoutineScheduleStartupRecovery } from "../routine-schedule-startup-recovery";

describe("RoutineScheduleStartupRecovery", function _Suite()
{
	it("walks more than two pages and totals every checked routine", async function _Pages()
	{
		const repair = vi.fn()
			.mockResolvedValueOnce({ checked: 2, nextCursor: "routine-2" })
			.mockResolvedValueOnce({ checked: 2, nextCursor: "routine-4" })
			.mockResolvedValueOnce({ checked: 1, nextCursor: null });
		const recovery = new RoutineScheduleStartupRecovery({ repairActiveSchedulesPage: repair }, "silo-1", 2);

		await expect(recovery.repairAllActiveSchedules()).resolves.toBe(5);
		expect(repair.mock.calls.map(call => call[0])).toEqual([
			{ siloId: "silo-1", limit: 2, afterRoutineId: null },
			{ siloId: "silo-1", limit: 2, afterRoutineId: "routine-2" },
			{ siloId: "silo-1", limit: 2, afterRoutineId: "routine-4" },
		]);
	});

	it("allows an exact full page followed by an empty page", async function _ExactFull()
	{
		const repair = vi.fn().mockResolvedValueOnce({ checked: 2, nextCursor: "routine-2" }).mockResolvedValueOnce({ checked: 0, nextCursor: null });

		await expect(new RoutineScheduleStartupRecovery({ repairActiveSchedulesPage: repair }, "silo-1", 2).repairAllActiveSchedules()).resolves.toBe(2);
	});

	it.each([
		[{ checked: 3, nextCursor: "routine-3" }],
		[{ checked: 1, nextCursor: "routine-1" }],
		[{ checked: 0, nextCursor: "routine-1" }],
		[{ checked: 2, nextCursor: null }],
	] as const)("rejects malformed page result %j", async function _Malformed(result)
	{
		const repair = vi.fn().mockResolvedValue(result);

		await expect(new RoutineScheduleStartupRecovery({ repairActiveSchedulesPage: repair }, "silo-1", 2).repairAllActiveSchedules()).rejects.toThrow();
	});

	it("rejects a repeated or non-advancing cursor and propagates page failure", async function _CursorAndFailure()
	{
		const repeated = vi.fn().mockResolvedValue({ checked: 1, nextCursor: "routine-1" });
		const recovery = new RoutineScheduleStartupRecovery({ repairActiveSchedulesPage: repeated }, "silo-1", 1);
		await expect(recovery.repairAllActiveSchedules()).rejects.toThrow("non-advancing");

		const failure = new Error("page failed");
		const failed = new RoutineScheduleStartupRecovery({ repairActiveSchedulesPage: vi.fn().mockRejectedValue(failure) }, "silo-1");
		await expect(failed.repairAllActiveSchedules()).rejects.toBe(failure);
	});

	it("rejects invalid startup scope", function _InvalidScope()
	{
		expect(() => new RoutineScheduleStartupRecovery({ repairActiveSchedulesPage: vi.fn() }, " ")).toThrow();
		expect(() => new RoutineScheduleStartupRecovery({ repairActiveSchedulesPage: vi.fn() }, "silo-1", 101)).toThrow();
	});
});
