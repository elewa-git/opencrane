import { DeferredToolApprovalLifecycleActions, DeferredToolApprovalLifecycleEvents, DeferredToolApprovalRunStates, type DeferredToolApprovalLifecycleInput } from "./deferred-tool-approval-lifecycle.types.js";

/** State-owned handler signature used by the exhaustive run lifecycle registry. */
type DeferredToolApprovalStateHandler = (input: DeferredToolApprovalLifecycleInput) => DeferredToolApprovalLifecycleActions;

/** Handle approval events while the run is executing normally. */
function _running(input: DeferredToolApprovalLifecycleInput): DeferredToolApprovalLifecycleActions
{
	if (input.event === DeferredToolApprovalLifecycleEvents.Open && input.pendingCount === 0) return DeferredToolApprovalLifecycleActions.PauseAndOpen;
	if (input.event === DeferredToolApprovalLifecycleEvents.Cancellation) return DeferredToolApprovalLifecycleActions.Cancel;
	return DeferredToolApprovalLifecycleActions.Reject;
}

/** Handle approval events while one batch owns the run's pause. */
function _waiting(input: DeferredToolApprovalLifecycleInput): DeferredToolApprovalLifecycleActions
{
	if (input.event === DeferredToolApprovalLifecycleEvents.Open) return DeferredToolApprovalLifecycleActions.OpenInBatch;
	if (input.event === DeferredToolApprovalLifecycleEvents.Cancellation) return DeferredToolApprovalLifecycleActions.Cancel;
	if (input.event === DeferredToolApprovalLifecycleEvents.Decision || input.event === DeferredToolApprovalLifecycleEvents.Expiry)
	{
		return input.pendingCount === 0 ? DeferredToolApprovalLifecycleActions.Resume : DeferredToolApprovalLifecycleActions.KeepWaiting;
	}
	return DeferredToolApprovalLifecycleActions.Reject;
}

/** Reject approval events for run states that cannot own a live approval batch. */
function _closed(): DeferredToolApprovalLifecycleActions
{
	return DeferredToolApprovalLifecycleActions.Reject;
}

/** Exhaustive State registry; adding an AgentRun state requires an explicit approval policy. */
const _STATE_HANDLERS: Readonly<Record<DeferredToolApprovalRunStates, DeferredToolApprovalStateHandler>> = {
	[DeferredToolApprovalRunStates.Accepted]: _closed,
	[DeferredToolApprovalRunStates.Queued]: _closed,
	[DeferredToolApprovalRunStates.Assigned]: _closed,
	[DeferredToolApprovalRunStates.Running]: _running,
	[DeferredToolApprovalRunStates.WaitingForInput]: _waiting,
	[DeferredToolApprovalRunStates.RecoveryRequired]: _closed,
	[DeferredToolApprovalRunStates.Cancelling]: _closed,
	[DeferredToolApprovalRunStates.Completed]: _closed,
	[DeferredToolApprovalRunStates.Failed]: _closed,
	[DeferredToolApprovalRunStates.Cancelled]: _closed,
};

/**
 * Decide what happens to the RUN when one of its approvals opens or resolves.
 *
 * Deliberately blind to whether the approval was approved, denied, or expired — those produce
 * different results for the tool call, but the run pauses and resumes the same way regardless. So
 * this only ever chooses: pause, add to the current batch, keep waiting, resume, cancel, or reject.
 *
 * Called by: ./deferred-tool-approval.ts (`__DeferToolRequest` for `Open`, and
 * `_FinishDeferredToolApprovalBatch` for `Decision` and `Expiry`).
 * @param input - Run state, the event, and the pending count after the approval row changed.
 * @returns The single permitted write, or `Reject` when the event is invalid for that run state.
 *   `_FinishDeferredToolApprovalBatch` throws on anything other than `KeepWaiting` or `Resume`.
 */
export function __PlanDeferredToolApprovalLifecycle(input: DeferredToolApprovalLifecycleInput): DeferredToolApprovalLifecycleActions
{
	if (!Number.isSafeInteger(input.pendingCount) || input.pendingCount < 0) return DeferredToolApprovalLifecycleActions.Reject;
	return _STATE_HANDLERS[input.runState](input);
}
