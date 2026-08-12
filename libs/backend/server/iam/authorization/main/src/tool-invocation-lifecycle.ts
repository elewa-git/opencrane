import { ExternalActionClaimKinds, ExternalActionRecoveryModes, ToolInvocationLifecycleActions, ToolInvocationLifecycleEvents, ToolInvocationStates, type ToolInvocationLifecycleInput } from "./tool-invocation-lifecycle.types.js";

/** Handler signature owned by one durable ToolInvocation state. */
type ToolInvocationStateHandler = (input: ToolInvocationLifecycleInput) => ToolInvocationLifecycleActions;

/** Interpret events before any provider adapter is eligible to run. */
function _preparing(input: ToolInvocationLifecycleInput): ToolInvocationLifecycleActions
{
	if (input.event === ToolInvocationLifecycleEvents.Prepared) return ToolInvocationLifecycleActions.MarkReady;
	if (input.event === ToolInvocationLifecycleEvents.PreparedForApproval) return ToolInvocationLifecycleActions.AwaitApproval;
	if (input.event === ToolInvocationLifecycleEvents.Cancelled) return ToolInvocationLifecycleActions.Fail;
	if (input.event !== ToolInvocationLifecycleEvents.PreparationFailed) return ToolInvocationLifecycleActions.Reject;
	return input.preparationAttempt + 1 < input.preparationAttemptLimit && input.withinPreparationDeadline
		? ToolInvocationLifecycleActions.RetryPreparation
		: ToolInvocationLifecycleActions.Fail;
}

/** Interpret authenticated decisions while provider dispatch remains impossible. */
function _awaitingApproval(input: ToolInvocationLifecycleInput): ToolInvocationLifecycleActions
{
	if (input.event === ToolInvocationLifecycleEvents.Approved) return ToolInvocationLifecycleActions.Approve;
	if (input.event === ToolInvocationLifecycleEvents.ApprovalRejected || input.event === ToolInvocationLifecycleEvents.Cancelled) return ToolInvocationLifecycleActions.Fail;
	return ToolInvocationLifecycleActions.Reject;
}

/** Interpret events for prepared work awaiting a provider claim. */
function _ready(input: ToolInvocationLifecycleInput): ToolInvocationLifecycleActions
{
	if (input.event === ToolInvocationLifecycleEvents.DispatchClaimed) return ToolInvocationLifecycleActions.ClaimDispatch;
	if (input.event === ToolInvocationLifecycleEvents.Cancelled) return ToolInvocationLifecycleActions.Fail;
	return ToolInvocationLifecycleActions.Reject;
}

/** Select the sole safe response after a dispatch outcome or an expired dispatch claim. */
function _claimed(input: ToolInvocationLifecycleInput): ToolInvocationLifecycleActions
{
	if (input.event === ToolInvocationLifecycleEvents.DispatchSucceeded) return ToolInvocationLifecycleActions.Succeed;
	if (input.event === ToolInvocationLifecycleEvents.DispatchRejected) return ToolInvocationLifecycleActions.Fail;
	if (input.event === ToolInvocationLifecycleEvents.DispatchProvenNotStarted)
	{
		return input.preparationAttempt + 1 < input.preparationAttemptLimit && input.withinPreparationDeadline
			? ToolInvocationLifecycleActions.Redispatch
			: ToolInvocationLifecycleActions.Fail;
	}
	if (input.event !== ToolInvocationLifecycleEvents.DispatchAmbiguous && input.event !== ToolInvocationLifecycleEvents.DispatchClaimExpired) return ToolInvocationLifecycleActions.Reject;
	if (input.recoveryMode === ExternalActionRecoveryModes.ProviderIdempotency) return ToolInvocationLifecycleActions.RedispatchIdempotently;
	if (input.recoveryMode === ExternalActionRecoveryModes.Reconciliation) return ToolInvocationLifecycleActions.BeginReconciliation;
	return ToolInvocationLifecycleActions.RequireManualRecovery;
}

/** Interpret provider-readback outcomes without granting a provider dispatch. */
function _reconciling(input: ToolInvocationLifecycleInput): ToolInvocationLifecycleActions
{
	if (input.event === ToolInvocationLifecycleEvents.ReconcileClaimed && input.claimKind === null) return ToolInvocationLifecycleActions.ClaimReconciliation;
	if (input.event === ToolInvocationLifecycleEvents.Cancelled && input.claimKind === null) return ToolInvocationLifecycleActions.Fail;
	if (input.claimKind !== ExternalActionClaimKinds.Reconcile) return ToolInvocationLifecycleActions.Reject;
	if (input.event === ToolInvocationLifecycleEvents.ReconcileSucceeded) return ToolInvocationLifecycleActions.Succeed;
	if (input.event === ToolInvocationLifecycleEvents.ReconcileFailed) return ToolInvocationLifecycleActions.Fail;
	if (input.event === ToolInvocationLifecycleEvents.ReconcileAbsent) return ToolInvocationLifecycleActions.Redispatch;
	if (input.event === ToolInvocationLifecycleEvents.ReconcileProvenNotStarted)
	{
		return input.preparationAttempt + 1 < input.preparationAttemptLimit && input.withinPreparationDeadline
			? ToolInvocationLifecycleActions.RetryReconciliation
			: ToolInvocationLifecycleActions.RequireManualRecovery;
	}
	if (input.event === ToolInvocationLifecycleEvents.ReconcileClaimExpired) return ToolInvocationLifecycleActions.RetryReconciliation;
	if (input.event === ToolInvocationLifecycleEvents.ReconcileInconclusive) return ToolInvocationLifecycleActions.RequireManualRecovery;
	return ToolInvocationLifecycleActions.Reject;
}

/** Reject every event after a terminal result delivery exists. */
function _terminal(): ToolInvocationLifecycleActions
{
	return ToolInvocationLifecycleActions.Reject;
}

/** Manual recovery is inert except for server-authoritative cancellation. */
function _recoveryRequired(input: ToolInvocationLifecycleInput): ToolInvocationLifecycleActions
{
	return input.event === ToolInvocationLifecycleEvents.Cancelled ? ToolInvocationLifecycleActions.Fail : ToolInvocationLifecycleActions.Reject;
}

/** One handler per state; adding a state to the enum will not compile until it is listed here. */
const _STATE_HANDLERS: Readonly<Record<ToolInvocationStates, ToolInvocationStateHandler>> = {
	[ToolInvocationStates.Preparing]: _preparing,
	[ToolInvocationStates.AwaitingApproval]: _awaitingApproval,
	[ToolInvocationStates.Ready]: _ready,
	[ToolInvocationStates.Claimed]: _claimed,
	[ToolInvocationStates.Reconciling]: _reconciling,
	[ToolInvocationStates.Succeeded]: _terminal,
	[ToolInvocationStates.Failed]: _terminal,
	[ToolInvocationStates.RecoveryRequired]: _recoveryRequired,
};

/** Select the only valid persistence action for a durable ToolInvocation State x Event cell. */
export function __PlanToolInvocationLifecycle(input: ToolInvocationLifecycleInput): ToolInvocationLifecycleActions
{
	if (!Number.isSafeInteger(input.preparationAttempt) || input.preparationAttempt < 0) return ToolInvocationLifecycleActions.Reject;
	if (!Number.isSafeInteger(input.preparationAttemptLimit) || input.preparationAttemptLimit < 1) return ToolInvocationLifecycleActions.Reject;
	if (input.state === ToolInvocationStates.Claimed && input.claimKind !== ExternalActionClaimKinds.Dispatch) return ToolInvocationLifecycleActions.Reject;
	if (input.state === ToolInvocationStates.Reconciling && input.claimKind !== null && input.claimKind !== ExternalActionClaimKinds.Reconcile) return ToolInvocationLifecycleActions.Reject;
	if (input.state !== ToolInvocationStates.Claimed && input.state !== ToolInvocationStates.Reconciling && input.claimKind !== null) return ToolInvocationLifecycleActions.Reject;
	return _STATE_HANDLERS[input.state](input);
}
