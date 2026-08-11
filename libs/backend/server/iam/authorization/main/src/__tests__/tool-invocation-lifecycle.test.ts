import { describe, expect, it } from "vitest";

import { __PlanToolInvocationLifecycle } from "../tool-invocation-lifecycle.js";
import { ExternalActionClaimKinds, ExternalActionRecoveryModes, ToolInvocationLifecycleActions, ToolInvocationLifecycleEvents, ToolInvocationStates, type ToolInvocationLifecycleInput } from "../tool-invocation-lifecycle.types.js";

/** Build one complete decision input while allowing the focused cell to vary. */
function _input(overrides: Partial<ToolInvocationLifecycleInput>): ToolInvocationLifecycleInput
{
	return { state: ToolInvocationStates.Preparing, event: ToolInvocationLifecycleEvents.Prepared, recoveryMode: ExternalActionRecoveryModes.Manual, claimKind: null, preparationAttempt: 1, preparationAttemptLimit: 3, withinPreparationDeadline: true, ...overrides };
}

describe("ToolInvocation lifecycle", function _suite()
{
	it("owns every durable State x Event cell exhaustively", function _exhaustive()
	{
		for (const state of Object.values(ToolInvocationStates))
		{
			for (const event of Object.values(ToolInvocationLifecycleEvents))
			{
				expect(Object.values(ToolInvocationLifecycleActions)).toContain(__PlanToolInvocationLifecycle(_input({ state, event })));
			}
		}
	});

	it("retries provider-free preparation at most three times and only inside its deadline", function _preparationBudget()
	{
		expect(__PlanToolInvocationLifecycle(_input({ event: ToolInvocationLifecycleEvents.PreparationFailed, preparationAttempt: 1 }))).toBe(ToolInvocationLifecycleActions.RetryPreparation);
		expect(__PlanToolInvocationLifecycle(_input({ event: ToolInvocationLifecycleEvents.PreparationFailed, preparationAttempt: 2 }))).toBe(ToolInvocationLifecycleActions.Fail);
		expect(__PlanToolInvocationLifecycle(_input({ event: ToolInvocationLifecycleEvents.PreparationFailed, preparationAttempt: 1, withinPreparationDeadline: false }))).toBe(ToolInvocationLifecycleActions.Fail);
	});

	it("selects recovery only from the frozen trusted-adapter capability", function _recoveryStrategy()
	{
		const base = { state: ToolInvocationStates.Claimed, event: ToolInvocationLifecycleEvents.DispatchAmbiguous, claimKind: ExternalActionClaimKinds.Dispatch };
		expect(__PlanToolInvocationLifecycle(_input({ ...base, recoveryMode: ExternalActionRecoveryModes.ProviderIdempotency }))).toBe(ToolInvocationLifecycleActions.RedispatchIdempotently);
		expect(__PlanToolInvocationLifecycle(_input({ ...base, recoveryMode: ExternalActionRecoveryModes.Reconciliation }))).toBe(ToolInvocationLifecycleActions.BeginReconciliation);
		expect(__PlanToolInvocationLifecycle(_input({ ...base, recoveryMode: ExternalActionRecoveryModes.Manual }))).toBe(ToolInvocationLifecycleActions.RequireManualRecovery);
	});

	it("never turns ambiguous manual work into a blind redispatch", function _manual()
	{
		expect(__PlanToolInvocationLifecycle(_input({ state: ToolInvocationStates.RecoveryRequired, event: ToolInvocationLifecycleEvents.DispatchClaimed }))).toBe(ToolInvocationLifecycleActions.Reject);
		expect(__PlanToolInvocationLifecycle(_input({ state: ToolInvocationStates.RecoveryRequired, event: ToolInvocationLifecycleEvents.Cancelled }))).toBe(ToolInvocationLifecycleActions.Fail);
	});

	it("leaves active provider claims fenced during cancellation", function _activeCancellation()
	{
		expect(__PlanToolInvocationLifecycle(_input({ state: ToolInvocationStates.Claimed, claimKind: ExternalActionClaimKinds.Dispatch, event: ToolInvocationLifecycleEvents.Cancelled }))).toBe(ToolInvocationLifecycleActions.Reject);
		expect(__PlanToolInvocationLifecycle(_input({ state: ToolInvocationStates.Reconciling, claimKind: ExternalActionClaimKinds.Reconcile, event: ToolInvocationLifecycleEvents.Cancelled }))).toBe(ToolInvocationLifecycleActions.Reject);
		expect(__PlanToolInvocationLifecycle(_input({ state: ToolInvocationStates.Reconciling, claimKind: null, event: ToolInvocationLifecycleEvents.Cancelled }))).toBe(ToolInvocationLifecycleActions.Fail);
	});
});
