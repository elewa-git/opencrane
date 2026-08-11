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
 * Select the sole persistence action for one durable State x Event cell.
 *
 * Decision kind is deliberately not interpreted here. Approved, denied, and expired payloads use
 * independent result strategies; this owner controls only pause, batching, resume, and rejection.
 */
export function __PlanDeferredToolApprovalLifecycle(input: DeferredToolApprovalLifecycleInput): DeferredToolApprovalLifecycleActions
{
	if (!Number.isSafeInteger(input.pendingCount) || input.pendingCount < 0) return DeferredToolApprovalLifecycleActions.Reject;
	return _STATE_HANDLERS[input.runState](input);
}
