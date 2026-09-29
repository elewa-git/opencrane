import { describe, expect, it } from "vitest";

import { RoutineStatus } from "@opencrane/models/agents";

import { __DecideRoutineLifecycle } from "../routine-lifecycle";
import { RoutineLifecycleDecisionKind, RoutineLifecycleEvent } from "../routine-lifecycle.types";

describe("routine lifecycle state by event table", function _suite()
{
	it.each([
		[RoutineStatus.Active, RoutineLifecycleEvent.Revise, RoutineLifecycleDecisionKind.Proceed, RoutineStatus.Active],
		[RoutineStatus.Active, RoutineLifecycleEvent.Pause, RoutineLifecycleDecisionKind.Proceed, RoutineStatus.Paused],
		[RoutineStatus.Active, RoutineLifecycleEvent.Resume, RoutineLifecycleDecisionKind.NoOp, RoutineStatus.Active],
		[RoutineStatus.Active, RoutineLifecycleEvent.Retire, RoutineLifecycleDecisionKind.Proceed, RoutineStatus.Retired],
		[RoutineStatus.Active, RoutineLifecycleEvent.RunNow, RoutineLifecycleDecisionKind.Proceed, RoutineStatus.Active],
		[RoutineStatus.Active, RoutineLifecycleEvent.AutomaticWake, RoutineLifecycleDecisionKind.Proceed, RoutineStatus.Active],
		[RoutineStatus.Paused, RoutineLifecycleEvent.Revise, RoutineLifecycleDecisionKind.Proceed, RoutineStatus.Paused],
		[RoutineStatus.Paused, RoutineLifecycleEvent.Pause, RoutineLifecycleDecisionKind.NoOp, RoutineStatus.Paused],
		[RoutineStatus.Paused, RoutineLifecycleEvent.Resume, RoutineLifecycleDecisionKind.Proceed, RoutineStatus.Active],
		[RoutineStatus.Paused, RoutineLifecycleEvent.Retire, RoutineLifecycleDecisionKind.Proceed, RoutineStatus.Retired],
		[RoutineStatus.Paused, RoutineLifecycleEvent.RunNow, RoutineLifecycleDecisionKind.Proceed, RoutineStatus.Paused],
		[RoutineStatus.Paused, RoutineLifecycleEvent.AutomaticWake, RoutineLifecycleDecisionKind.NoOp, RoutineStatus.Paused],
		[RoutineStatus.Retired, RoutineLifecycleEvent.Revise, RoutineLifecycleDecisionKind.NoOp, RoutineStatus.Retired],
		[RoutineStatus.Retired, RoutineLifecycleEvent.Pause, RoutineLifecycleDecisionKind.NoOp, RoutineStatus.Retired],
		[RoutineStatus.Retired, RoutineLifecycleEvent.Resume, RoutineLifecycleDecisionKind.NoOp, RoutineStatus.Retired],
		[RoutineStatus.Retired, RoutineLifecycleEvent.Retire, RoutineLifecycleDecisionKind.NoOp, RoutineStatus.Retired],
		[RoutineStatus.Retired, RoutineLifecycleEvent.RunNow, RoutineLifecycleDecisionKind.Refuse, RoutineStatus.Retired],
		[RoutineStatus.Retired, RoutineLifecycleEvent.AutomaticWake, RoutineLifecycleDecisionKind.NoOp, RoutineStatus.Retired],
	] as const)("handles %s with %s", function _cell(status, event, kind, nextStatus)
	{
		expect(__DecideRoutineLifecycle(status, event)).toEqual({ kind, nextStatus });
	});
});
