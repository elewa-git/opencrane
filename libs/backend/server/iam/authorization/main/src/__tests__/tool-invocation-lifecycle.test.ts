import { describe, expect, it } from "vitest";

import { __PlanToolInvocationLifecycle } from "../tool-invocation-lifecycle";
import { ExternalActionClaimKinds, ExternalActionRecoveryModes, ToolInvocationLifecycleActions, ToolInvocationLifecycleEvents, ToolInvocationStates, type ToolInvocationLifecycleInput } from "../tool-invocation-lifecycle.types";

/** Build one complete decision input while allowing the focused cell to vary. */
function _input(overrides: Partial<ToolInvocationLifecycleInput>): ToolInvocationLifecycleInput
{
	return { state: ToolInvocationStates.Preparing, event: ToolInvocationLifecycleEvents.Prepared, recoveryMode: ExternalActionRecoveryModes.Manual, claimKind: null, preparationAttempt: 1, preparationAttemptLimit: 3, withinPreparationDeadline: true, ...overrides };
}

/** Expected action for every current durable State x Event cell, using the default claim context built above. */
const _EXPECTED_ACTIONS = {
	[ToolInvocationStates.Preparing]: {
		[ToolInvocationLifecycleEvents.Prepared]: ToolInvocationLifecycleActions.MarkReady,
		[ToolInvocationLifecycleEvents.PreparedForApproval]: ToolInvocationLifecycleActions.AwaitApproval,
		[ToolInvocationLifecycleEvents.PreparationFailed]: ToolInvocationLifecycleActions.RetryPreparation,
		[ToolInvocationLifecycleEvents.Approved]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.ApprovalRejected]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.DispatchClaimed]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.DispatchSucceeded]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.DispatchRejected]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.DispatchProvenNotStarted]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.DispatchAmbiguous]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.DispatchClaimExpired]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.ReconcileClaimed]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.ReconcileSucceeded]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.ReconcileFailed]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.ReconcileAbsent]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.ReconcileInconclusive]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.ReconcileProvenNotStarted]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.ReconcileClaimExpired]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.Cancelled]: ToolInvocationLifecycleActions.Fail,
	},
	[ToolInvocationStates.AwaitingApproval]: {
		[ToolInvocationLifecycleEvents.Prepared]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.PreparedForApproval]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.PreparationFailed]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.Approved]: ToolInvocationLifecycleActions.Approve,
		[ToolInvocationLifecycleEvents.ApprovalRejected]: ToolInvocationLifecycleActions.Fail,
		[ToolInvocationLifecycleEvents.DispatchClaimed]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.DispatchSucceeded]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.DispatchRejected]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.DispatchProvenNotStarted]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.DispatchAmbiguous]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.DispatchClaimExpired]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.ReconcileClaimed]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.ReconcileSucceeded]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.ReconcileFailed]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.ReconcileAbsent]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.ReconcileInconclusive]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.ReconcileProvenNotStarted]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.ReconcileClaimExpired]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.Cancelled]: ToolInvocationLifecycleActions.Fail,
	},
	[ToolInvocationStates.Ready]: {
		[ToolInvocationLifecycleEvents.Prepared]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.PreparedForApproval]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.PreparationFailed]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.Approved]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.ApprovalRejected]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.DispatchClaimed]: ToolInvocationLifecycleActions.ClaimDispatch,
		[ToolInvocationLifecycleEvents.DispatchSucceeded]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.DispatchRejected]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.DispatchProvenNotStarted]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.DispatchAmbiguous]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.DispatchClaimExpired]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.ReconcileClaimed]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.ReconcileSucceeded]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.ReconcileFailed]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.ReconcileAbsent]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.ReconcileInconclusive]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.ReconcileProvenNotStarted]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.ReconcileClaimExpired]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.Cancelled]: ToolInvocationLifecycleActions.Fail,
	},
	[ToolInvocationStates.Claimed]: {
		[ToolInvocationLifecycleEvents.Prepared]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.PreparedForApproval]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.PreparationFailed]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.Approved]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.ApprovalRejected]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.DispatchClaimed]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.DispatchSucceeded]: ToolInvocationLifecycleActions.Succeed,
		[ToolInvocationLifecycleEvents.DispatchRejected]: ToolInvocationLifecycleActions.Fail,
		[ToolInvocationLifecycleEvents.DispatchProvenNotStarted]: ToolInvocationLifecycleActions.Redispatch,
		[ToolInvocationLifecycleEvents.DispatchAmbiguous]: ToolInvocationLifecycleActions.RequireManualRecovery,
		[ToolInvocationLifecycleEvents.DispatchClaimExpired]: ToolInvocationLifecycleActions.RequireManualRecovery,
		[ToolInvocationLifecycleEvents.ReconcileClaimed]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.ReconcileSucceeded]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.ReconcileFailed]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.ReconcileAbsent]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.ReconcileInconclusive]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.ReconcileProvenNotStarted]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.ReconcileClaimExpired]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.Cancelled]: ToolInvocationLifecycleActions.Reject,
	},
	[ToolInvocationStates.Reconciling]: {
		[ToolInvocationLifecycleEvents.Prepared]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.PreparedForApproval]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.PreparationFailed]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.Approved]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.ApprovalRejected]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.DispatchClaimed]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.DispatchSucceeded]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.DispatchRejected]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.DispatchProvenNotStarted]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.DispatchAmbiguous]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.DispatchClaimExpired]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.ReconcileClaimed]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.ReconcileSucceeded]: ToolInvocationLifecycleActions.Succeed,
		[ToolInvocationLifecycleEvents.ReconcileFailed]: ToolInvocationLifecycleActions.Fail,
		[ToolInvocationLifecycleEvents.ReconcileAbsent]: ToolInvocationLifecycleActions.Redispatch,
		[ToolInvocationLifecycleEvents.ReconcileInconclusive]: ToolInvocationLifecycleActions.RequireManualRecovery,
		[ToolInvocationLifecycleEvents.ReconcileProvenNotStarted]: ToolInvocationLifecycleActions.RetryReconciliation,
		[ToolInvocationLifecycleEvents.ReconcileClaimExpired]: ToolInvocationLifecycleActions.RetryReconciliation,
		[ToolInvocationLifecycleEvents.Cancelled]: ToolInvocationLifecycleActions.Reject,
	},
	[ToolInvocationStates.Succeeded]: {
		[ToolInvocationLifecycleEvents.Prepared]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.PreparedForApproval]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.PreparationFailed]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.Approved]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.ApprovalRejected]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.DispatchClaimed]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.DispatchSucceeded]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.DispatchRejected]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.DispatchProvenNotStarted]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.DispatchAmbiguous]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.DispatchClaimExpired]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.ReconcileClaimed]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.ReconcileSucceeded]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.ReconcileFailed]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.ReconcileAbsent]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.ReconcileInconclusive]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.ReconcileProvenNotStarted]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.ReconcileClaimExpired]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.Cancelled]: ToolInvocationLifecycleActions.Reject,
	},
	[ToolInvocationStates.Failed]: {
		[ToolInvocationLifecycleEvents.Prepared]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.PreparedForApproval]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.PreparationFailed]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.Approved]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.ApprovalRejected]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.DispatchClaimed]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.DispatchSucceeded]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.DispatchRejected]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.DispatchProvenNotStarted]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.DispatchAmbiguous]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.DispatchClaimExpired]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.ReconcileClaimed]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.ReconcileSucceeded]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.ReconcileFailed]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.ReconcileAbsent]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.ReconcileInconclusive]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.ReconcileProvenNotStarted]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.ReconcileClaimExpired]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.Cancelled]: ToolInvocationLifecycleActions.Reject,
	},
	[ToolInvocationStates.RecoveryRequired]: {
		[ToolInvocationLifecycleEvents.Prepared]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.PreparedForApproval]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.PreparationFailed]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.Approved]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.ApprovalRejected]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.DispatchClaimed]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.DispatchSucceeded]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.DispatchRejected]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.DispatchProvenNotStarted]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.DispatchAmbiguous]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.DispatchClaimExpired]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.ReconcileClaimed]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.ReconcileSucceeded]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.ReconcileFailed]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.ReconcileAbsent]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.ReconcileInconclusive]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.ReconcileProvenNotStarted]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.ReconcileClaimExpired]: ToolInvocationLifecycleActions.Reject,
		[ToolInvocationLifecycleEvents.Cancelled]: ToolInvocationLifecycleActions.Fail,
	},
} satisfies Readonly<Record<ToolInvocationStates, Readonly<Record<ToolInvocationLifecycleEvents, ToolInvocationLifecycleActions>>>>;

/** Select the claim context in which the complete baseline matrix evaluates one durable state. */
function _claimKind(state: ToolInvocationStates): ExternalActionClaimKinds | null
{
	if (state === ToolInvocationStates.Claimed) return ExternalActionClaimKinds.Dispatch;
	if (state === ToolInvocationStates.Reconciling) return ExternalActionClaimKinds.Reconcile;
	return null;
}

describe("ToolInvocation lifecycle", function _suite()
{
	it("maps every durable State x Event cell to its exact expected action", function _exhaustive()
	{
		for (const state of Object.values(ToolInvocationStates))
		{
			for (const event of Object.values(ToolInvocationLifecycleEvents))
			{
				expect(__PlanToolInvocationLifecycle(_input({ state, event, claimKind: _claimKind(state) }))).toBe(_EXPECTED_ACTIONS[state][event]);
			}
		}
	});

	it("applies the five-minute window only to retries while allowing late first preparation success", function _preparationBudget()
	{
		expect(__PlanToolInvocationLifecycle(_input({ event: ToolInvocationLifecycleEvents.Prepared, preparationAttempt: 0, withinPreparationDeadline: false }))).toBe(ToolInvocationLifecycleActions.MarkReady);
		expect(__PlanToolInvocationLifecycle(_input({ event: ToolInvocationLifecycleEvents.PreparationFailed, preparationAttempt: 1 }))).toBe(ToolInvocationLifecycleActions.RetryPreparation);
		expect(__PlanToolInvocationLifecycle(_input({ event: ToolInvocationLifecycleEvents.PreparationFailed, preparationAttempt: 2 }))).toBe(ToolInvocationLifecycleActions.Fail);
		expect(__PlanToolInvocationLifecycle(_input({ event: ToolInvocationLifecycleEvents.PreparationFailed, preparationAttempt: 1, withinPreparationDeadline: false }))).toBe(ToolInvocationLifecycleActions.Fail);
		expect(__PlanToolInvocationLifecycle(_input({ state: ToolInvocationStates.Claimed, event: ToolInvocationLifecycleEvents.DispatchProvenNotStarted, claimKind: ExternalActionClaimKinds.Dispatch, preparationAttempt: 1, withinPreparationDeadline: false }))).toBe(ToolInvocationLifecycleActions.Fail);
		expect(__PlanToolInvocationLifecycle(_input({ state: ToolInvocationStates.Reconciling, event: ToolInvocationLifecycleEvents.ReconcileProvenNotStarted, claimKind: ExternalActionClaimKinds.Reconcile, preparationAttempt: 1, withinPreparationDeadline: false }))).toBe(ToolInvocationLifecycleActions.RequireManualRecovery);
	});

	it("distinguishes unclaimed reconciliation from an active readback claim", function _reconciliationClaims()
	{
		expect(__PlanToolInvocationLifecycle(_input({ state: ToolInvocationStates.Reconciling, event: ToolInvocationLifecycleEvents.ReconcileClaimed, claimKind: null }))).toBe(ToolInvocationLifecycleActions.ClaimReconciliation);
		expect(__PlanToolInvocationLifecycle(_input({ state: ToolInvocationStates.Reconciling, event: ToolInvocationLifecycleEvents.Cancelled, claimKind: null }))).toBe(ToolInvocationLifecycleActions.Fail);
		expect(__PlanToolInvocationLifecycle(_input({ state: ToolInvocationStates.Reconciling, event: ToolInvocationLifecycleEvents.ReconcileSucceeded, claimKind: ExternalActionClaimKinds.Dispatch }))).toBe(ToolInvocationLifecycleActions.Reject);
		expect(__PlanToolInvocationLifecycle(_input({ state: ToolInvocationStates.Claimed, event: ToolInvocationLifecycleEvents.DispatchSucceeded, claimKind: ExternalActionClaimKinds.Reconcile }))).toBe(ToolInvocationLifecycleActions.Reject);
	});

	it("selects recovery only from the frozen trusted-adapter capability", function _recoveryStrategy()
	{
		for (const event of [ToolInvocationLifecycleEvents.DispatchAmbiguous, ToolInvocationLifecycleEvents.DispatchClaimExpired])
		{
			const base = { state: ToolInvocationStates.Claimed, event, claimKind: ExternalActionClaimKinds.Dispatch };
			expect(__PlanToolInvocationLifecycle(_input({ ...base, recoveryMode: ExternalActionRecoveryModes.ProviderIdempotency }))).toBe(ToolInvocationLifecycleActions.RedispatchIdempotently);
			expect(__PlanToolInvocationLifecycle(_input({ ...base, recoveryMode: ExternalActionRecoveryModes.Reconciliation }))).toBe(ToolInvocationLifecycleActions.BeginReconciliation);
			expect(__PlanToolInvocationLifecycle(_input({ ...base, recoveryMode: ExternalActionRecoveryModes.Manual }))).toBe(ToolInvocationLifecycleActions.RequireManualRecovery);
		}
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
