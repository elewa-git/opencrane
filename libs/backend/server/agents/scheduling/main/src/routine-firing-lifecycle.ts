import { RoutineFiringDisposition, type RoutineUnfinishedFiringDisposition } from "@opencrane/models/agents";

/** Dispositions that continue to block a later automatic occurrence. */
const _UNFINISHED_FIRING_DISPOSITIONS: readonly RoutineFiringDisposition[] = [
	RoutineFiringDisposition.Preparing,
	RoutineFiringDisposition.Running,
	RoutineFiringDisposition.Waiting,
	RoutineFiringDisposition.Uncertain,
];

/** Returns whether a firing still owns the routine's single-work fence. */
export function __IsRoutineFiringUnfinished(disposition: RoutineFiringDisposition): disposition is RoutineUnfinishedFiringDisposition
{
	return _UNFINISHED_FIRING_DISPOSITIONS.includes(disposition);
}

/** Returns whether a linked run may move between durable progress states. */
export function __MayTransitionRoutineFiringProgress(current: RoutineFiringDisposition, target: RoutineFiringDisposition): boolean
{
	if (current === RoutineFiringDisposition.Running || current === RoutineFiringDisposition.Waiting)
	{
		return _IsRunProgressDisposition(target);
	}
	if (current === RoutineFiringDisposition.Uncertain)
	{
		return target === RoutineFiringDisposition.Running || target === RoutineFiringDisposition.Completed || target === RoutineFiringDisposition.Failed || target === RoutineFiringDisposition.Cancelled;
	}
	return false;
}

/** Restricts run-owned transitions to states backed by linked AgentRun progress. */
function _IsRunProgressDisposition(disposition: RoutineFiringDisposition): boolean
{
	return disposition === RoutineFiringDisposition.Running || disposition === RoutineFiringDisposition.Waiting || disposition === RoutineFiringDisposition.Completed || disposition === RoutineFiringDisposition.Failed || disposition === RoutineFiringDisposition.Cancelled || disposition === RoutineFiringDisposition.Uncertain;
}
