import { RoutineStatus } from "@opencrane/models/agents";

import { RoutineLifecycleDecisionKind, RoutineLifecycleEvent, type RoutineLifecycleDecision } from "./routine-lifecycle.types";

/** Makes every lifecycle State by Event cell explicit and compilation-checked. */
const _ROUTINE_LIFECYCLE: Readonly<Record<RoutineStatus, Readonly<Record<RoutineLifecycleEvent, RoutineLifecycleDecision>>>> = {
	[RoutineStatus.Active]: {
		[RoutineLifecycleEvent.Revise]: { kind: RoutineLifecycleDecisionKind.Proceed, nextStatus: RoutineStatus.Active },
		[RoutineLifecycleEvent.Pause]: { kind: RoutineLifecycleDecisionKind.Proceed, nextStatus: RoutineStatus.Paused },
		[RoutineLifecycleEvent.Resume]: { kind: RoutineLifecycleDecisionKind.NoOp, nextStatus: RoutineStatus.Active },
		[RoutineLifecycleEvent.Retire]: { kind: RoutineLifecycleDecisionKind.Proceed, nextStatus: RoutineStatus.Retired },
		[RoutineLifecycleEvent.RunNow]: { kind: RoutineLifecycleDecisionKind.Proceed, nextStatus: RoutineStatus.Active },
		[RoutineLifecycleEvent.AutomaticWake]: { kind: RoutineLifecycleDecisionKind.Proceed, nextStatus: RoutineStatus.Active },
	},
	[RoutineStatus.Paused]: {
		[RoutineLifecycleEvent.Revise]: { kind: RoutineLifecycleDecisionKind.Proceed, nextStatus: RoutineStatus.Paused },
		[RoutineLifecycleEvent.Pause]: { kind: RoutineLifecycleDecisionKind.NoOp, nextStatus: RoutineStatus.Paused },
		[RoutineLifecycleEvent.Resume]: { kind: RoutineLifecycleDecisionKind.Proceed, nextStatus: RoutineStatus.Active },
		[RoutineLifecycleEvent.Retire]: { kind: RoutineLifecycleDecisionKind.Proceed, nextStatus: RoutineStatus.Retired },
		[RoutineLifecycleEvent.RunNow]: { kind: RoutineLifecycleDecisionKind.Proceed, nextStatus: RoutineStatus.Paused },
		[RoutineLifecycleEvent.AutomaticWake]: { kind: RoutineLifecycleDecisionKind.NoOp, nextStatus: RoutineStatus.Paused },
	},
	[RoutineStatus.Retired]: {
		[RoutineLifecycleEvent.Revise]: { kind: RoutineLifecycleDecisionKind.NoOp, nextStatus: RoutineStatus.Retired },
		[RoutineLifecycleEvent.Pause]: { kind: RoutineLifecycleDecisionKind.NoOp, nextStatus: RoutineStatus.Retired },
		[RoutineLifecycleEvent.Resume]: { kind: RoutineLifecycleDecisionKind.NoOp, nextStatus: RoutineStatus.Retired },
		[RoutineLifecycleEvent.Retire]: { kind: RoutineLifecycleDecisionKind.NoOp, nextStatus: RoutineStatus.Retired },
		[RoutineLifecycleEvent.RunNow]: { kind: RoutineLifecycleDecisionKind.Refuse, nextStatus: RoutineStatus.Retired },
		[RoutineLifecycleEvent.AutomaticWake]: { kind: RoutineLifecycleDecisionKind.NoOp, nextStatus: RoutineStatus.Retired },
	},
};

/**
 * Reads one explicit State by Event cell without performing authorization or persistence.
 *
 * Persistence still owns requester checks, current grants, the database clock, and the atomic
 * compare-and-set. Keeping those guards outside this table prevents a saved status from granting
 * permission by itself.
 */
export function __DecideRoutineLifecycle(status: RoutineStatus, event: RoutineLifecycleEvent): RoutineLifecycleDecision
{
	return _ROUTINE_LIFECYCLE[status][event];
}
