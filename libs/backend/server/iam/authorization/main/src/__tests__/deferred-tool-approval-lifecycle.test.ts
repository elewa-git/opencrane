import { describe, expect, it } from "vitest";

import { __PlanDeferredToolApprovalLifecycle } from "../deferred-tool-approval-lifecycle.js";
import { DeferredToolApprovalLifecycleActions, DeferredToolApprovalLifecycleEvents, DeferredToolApprovalRunStates } from "../deferred-tool-approval.types.js";

describe("deferred tool approval State x Event table", function _suite()
{
	it.each([
		[DeferredToolApprovalRunStates.Running, DeferredToolApprovalLifecycleEvents.Open, 0, DeferredToolApprovalLifecycleActions.PauseAndOpen],
		[DeferredToolApprovalRunStates.WaitingForApproval, DeferredToolApprovalLifecycleEvents.Open, 1, DeferredToolApprovalLifecycleActions.OpenInBatch],
		[DeferredToolApprovalRunStates.WaitingForApproval, DeferredToolApprovalLifecycleEvents.Open, 2, DeferredToolApprovalLifecycleActions.OpenInBatch],
		[DeferredToolApprovalRunStates.WaitingForApproval, DeferredToolApprovalLifecycleEvents.Decision, 1, DeferredToolApprovalLifecycleActions.KeepWaiting],
		[DeferredToolApprovalRunStates.WaitingForApproval, DeferredToolApprovalLifecycleEvents.Decision, 0, DeferredToolApprovalLifecycleActions.Resume],
		[DeferredToolApprovalRunStates.WaitingForApproval, DeferredToolApprovalLifecycleEvents.Expiry, 2, DeferredToolApprovalLifecycleActions.KeepWaiting],
		[DeferredToolApprovalRunStates.WaitingForApproval, DeferredToolApprovalLifecycleEvents.Expiry, 0, DeferredToolApprovalLifecycleActions.Resume],
		[DeferredToolApprovalRunStates.Running, DeferredToolApprovalLifecycleEvents.Cancellation, 0, DeferredToolApprovalLifecycleActions.Cancel],
		[DeferredToolApprovalRunStates.WaitingForApproval, DeferredToolApprovalLifecycleEvents.Cancellation, 2, DeferredToolApprovalLifecycleActions.Cancel],
	] as const)("maps %s x %s with %i pending to %s", function _maps(runState, event, pendingCount, expected)
	{
		expect(__PlanDeferredToolApprovalLifecycle({ runState, event, pendingCount })).toBe(expected);
	});

	it.each(Object.values(DeferredToolApprovalRunStates).filter(function _closed(state) { return state !== DeferredToolApprovalRunStates.Running && state !== DeferredToolApprovalRunStates.WaitingForApproval; }))("rejects open, decision, and expiry while the run is %s", function _rejectsClosed(runState)
	{
		for (const event of [DeferredToolApprovalLifecycleEvents.Open, DeferredToolApprovalLifecycleEvents.Decision, DeferredToolApprovalLifecycleEvents.Expiry])
		{
			expect(__PlanDeferredToolApprovalLifecycle({ runState, event, pendingCount: 0 })).toBe(DeferredToolApprovalLifecycleActions.Reject);
		}
	});

	it("rejects an impossible negative pending cardinality", function _rejectsInvalidCardinality()
	{
		expect(__PlanDeferredToolApprovalLifecycle({ runState: DeferredToolApprovalRunStates.WaitingForApproval, event: DeferredToolApprovalLifecycleEvents.Decision, pendingCount: -1 })).toBe(DeferredToolApprovalLifecycleActions.Reject);
	});
});
