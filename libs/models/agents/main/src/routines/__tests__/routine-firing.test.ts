import { afterEach, describe, expect, it, vi } from "vitest";

import { __PlanRoutineFiring, __RoutineFiringAuditActor } from "../routine-firing";
import { AgentRunTriggers } from "../../agent-run.types";
import type { RoutineFiringPlan, RoutineFiringSelection } from "../routine-firing.types";
import { RoutineFiringDisposition, RoutineFiringTrigger, RoutineStatus } from "../routine.types";

/** Marks when automatic scheduling most recently became active. */
const _ENABLED = Date.parse("2026-09-25T09:00:00Z");
/** Marks the previously consumed slot. */
const _TEN = Date.parse("2026-09-25T10:00:00Z");
/** Marks the latest due slot in the default fixture. */
const _TWELVE = Date.parse("2026-09-25T12:00:00Z");
/** Supplies the default database clock. */
const _NOW = Date.parse("2026-09-25T12:30:00Z");
/** Marks the next future slot in the default fixture. */
const _THIRTEEN = Date.parse("2026-09-25T13:00:00Z");

/** Builds a database-owned firing snapshot with focused overrides. */
function _selection(patch: Partial<RoutineFiringSelection> = {}): RoutineFiringSelection
{
	return {
		siloId: "silo-1",
		routineId: "routine-1",
		status: RoutineStatus.Active,
		trigger: RoutineFiringTrigger.Automatic,
		schedule: { expression: "0 * * * *", timezone: "UTC" },
		nowEpochMs: _NOW,
		automaticEnabledAfterEpochMs: _ENABLED,
		lastAutomaticOccurrenceEpochMs: _TEN,
		unfinishedFiringDisposition: null,
		...patch,
	};
}

/** Reads a firing identity from plans that create a saved outcome. */
function _firingKey(plan: RoutineFiringPlan): string | undefined
{
	if ("firingKey" in plan)
		return plan.firingKey;
	return undefined;
}

afterEach(function _restoreClock()
{
	vi.restoreAllMocks();
});

describe("routine status and trigger policy", function _policy()
{
	it.each([
		[RoutineStatus.Active, RoutineFiringTrigger.Automatic, RoutineFiringDisposition.Preparing],
		[RoutineStatus.Active, RoutineFiringTrigger.Manual, RoutineFiringDisposition.Preparing],
		[RoutineStatus.Paused, RoutineFiringTrigger.Automatic, null],
		[RoutineStatus.Paused, RoutineFiringTrigger.Manual, RoutineFiringDisposition.Preparing],
		[RoutineStatus.Retired, RoutineFiringTrigger.Automatic, null],
		[RoutineStatus.Retired, RoutineFiringTrigger.Manual, RoutineFiringDisposition.Refused],
	] as const)("handles %s with %s", function _cell(status, trigger, expected)
	{
		const base = _selection({ status, trigger });
		const input = trigger === RoutineFiringTrigger.Manual ? { ...base, manualRequestId: "command-1" } : base;
		const plan = __PlanRoutineFiring(input);
		expect(plan.disposition).toBe(expected);
		expect(plan.trigger).toBe(trigger);
		if (trigger === RoutineFiringTrigger.Manual || status !== RoutineStatus.Active)
		{
			expect("advanceAutomaticCursorToEpochMs" in plan).toBe(false);
			expect("scheduledForEpochMs" in plan).toBe(false);
			expect("nextAutomaticOccurrenceEpochMs" in plan).toBe(false);
		}
	});

	it.each([
		RoutineFiringDisposition.Preparing,
		RoutineFiringDisposition.Running,
		RoutineFiringDisposition.Waiting,
		RoutineFiringDisposition.Uncertain,
	] as const)("skips automatic overlap for unfinished %s work", function _overlap(unfinishedFiringDisposition)
	{
		const plan = __PlanRoutineFiring(_selection({ unfinishedFiringDisposition }));
		expect(plan.disposition).toBe(RoutineFiringDisposition.SkippedOverlap);
		expect("scheduledForEpochMs" in plan ? plan.scheduledForEpochMs : undefined).toBe(_TWELVE);
	});

	it("never applies overlap policy to a manual command", function _manualOverlap()
	{
		const plan = __PlanRoutineFiring(_selection({
			trigger: RoutineFiringTrigger.Manual,
			manualRequestId: "command-1",
			unfinishedFiringDisposition: RoutineFiringDisposition.Running,
		}));
		expect(plan.disposition).toBe(RoutineFiringDisposition.Preparing);
		expect("advanceAutomaticCursorToEpochMs" in plan).toBe(false);
	});
});

describe("routine firing audit actors", function _AuditActors()
{
	it("records the scheduler for automatic triggers and the saved requester for manual triggers", function _MapsTriggers()
	{
		expect(__RoutineFiringAuditActor(RoutineFiringTrigger.Automatic, "requester-1")).toEqual({ actorKind: "system", actorId: "opencrane-server/routine-schedule/v1" });
		expect(__RoutineFiringAuditActor(AgentRunTriggers.Scheduled, "requester-1")).toEqual({ actorKind: "system", actorId: "opencrane-server/routine-schedule/v1" });
		expect(__RoutineFiringAuditActor(RoutineFiringTrigger.Manual, "requester-1")).toEqual({ actorKind: "user", actorId: "requester-1" });
		expect(__RoutineFiringAuditActor(AgentRunTriggers.Manual, "requester-1")).toEqual({ actorKind: "user", actorId: "requester-1" });
	});
});

describe("latest automatic occurrence", function _automatic()
{
	it("selects the latest missed slot and returns the next slot", function _latest()
	{
		expect(__PlanRoutineFiring(_selection())).toEqual({
			disposition: RoutineFiringDisposition.Preparing,
			trigger: RoutineFiringTrigger.Automatic,
			firingKey: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
			scheduledForEpochMs: _TWELVE,
			advanceAutomaticCursorToEpochMs: _TWELVE,
			nextAutomaticOccurrenceEpochMs: _THIRTEEN,
		});
	});

	it("includes a slot exactly at the database clock", function _inclusive()
	{
		const plan = __PlanRoutineFiring(_selection({ nowEpochMs: _TWELVE }));
		expect("scheduledForEpochMs" in plan ? plan.scheduledForEpochMs : undefined).toBe(_TWELVE);
	});

	it("selects the latest prior slot one millisecond before the next slot", function _before()
	{
		const plan = __PlanRoutineFiring(_selection({ nowEpochMs: _TWELVE - 1 }));
		expect("scheduledForEpochMs" in plan ? plan.scheduledForEpochMs : undefined).toBe(Date.parse("2026-09-25T11:00:00Z"));
		expect("nextAutomaticOccurrenceEpochMs" in plan ? plan.nextAutomaticOccurrenceEpochMs : undefined).toBe(_TWELVE);
	});

	it.each([
		{ automaticEnabledAfterEpochMs: _TWELVE },
		{ lastAutomaticOccurrenceEpochMs: _TWELVE },
		{ automaticEnabledAfterEpochMs: _NOW },
		{ automaticEnabledAfterEpochMs: _THIRTEEN },
	])("does not reconsider excluded or consumed slots: %j", function _excluded(patch)
	{
		const plan = __PlanRoutineFiring(_selection(patch));
		expect(plan.disposition).toBeNull();
		expect("firingKey" in plan).toBe(false);
		expect("advanceAutomaticCursorToEpochMs" in plan).toBe(false);
	});

	it("does not replay paused slots after resume", function _resume()
	{
		const paused = _selection({ status: RoutineStatus.Paused });
		expect(__PlanRoutineFiring(paused).disposition).toBeNull();
		const resumed = { ...paused, status: RoutineStatus.Active, automaticEnabledAfterEpochMs: _NOW };
		expect(__PlanRoutineFiring(resumed).disposition).toBeNull();
		const later = __PlanRoutineFiring({ ...resumed, nowEpochMs: _THIRTEEN });
		expect("scheduledForEpochMs" in later ? later.scheduledForEpochMs : undefined).toBe(_THIRTEEN);
	});

	it("uses the supplied database clock instead of the host clock", function _clock()
	{
		vi.spyOn(Date, "now").mockReturnValue(Date.parse("2036-01-01T00:00:00Z"));
		const first = __PlanRoutineFiring(_selection());
		vi.spyOn(Date, "now").mockReturnValue(0);
		expect(__PlanRoutineFiring(_selection())).toEqual(first);
	});
});

describe("firing identity and input validation", function _identity()
{
	it("keeps automatic identity stable across recovery, overlap and schedule edits", function _automaticIdentity()
	{
		const first = __PlanRoutineFiring(_selection());
		const later = __PlanRoutineFiring(_selection({
			nowEpochMs: _NOW + 1,
			unfinishedFiringDisposition: RoutineFiringDisposition.Waiting,
			schedule: { expression: "0 12 * * *", timezone: "UTC" },
		}));
		expect(_firingKey(later)).toBe(_firingKey(first));
	});

	it("keeps manual identity stable without changing the automatic cursor", function _manualIdentity()
	{
		const request = _selection({ trigger: RoutineFiringTrigger.Manual, manualRequestId: "manual-1" });
		const first = __PlanRoutineFiring(request);
		const retried = __PlanRoutineFiring({ ...request, nowEpochMs: _THIRTEEN });
		expect(_firingKey(retried)).toBe(_firingKey(first));
		expect("advanceAutomaticCursorToEpochMs" in first).toBe(false);
	});

	it.each([
		{ status: "draft" }, { status: "unknown" }, { trigger: "timer" }, { routineId: " " }, { siloId: "" },
		{ nowEpochMs: Number.NaN }, { nowEpochMs: Infinity }, { nowEpochMs: 1.1 }, { nowEpochMs: "2026-09-25" },
		{ unfinishedFiringDisposition: RoutineFiringDisposition.Completed }, { nowEpochMs: _TEN - 1 }, { manualRequestId: "injected" },
		{ trigger: RoutineFiringTrigger.Manual }, { trigger: RoutineFiringTrigger.Manual, manualRequestId: " " },
		{ lastAutomaticOccurrenceEpochMs: _NOW + 1 }, { grants: ["run"] },
		{ schedule: { expression: "* * * * * *", timezone: "UTC" } },
	])("rejects %j instead of substituting defaults", function _invalid(patch)
	{
		expect(function _plan() { __PlanRoutineFiring({ ..._selection(), ...patch } as RoutineFiringSelection); }).toThrow();
	});
});
