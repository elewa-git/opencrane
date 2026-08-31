import { __PlanToolInvocationLifecycle } from "./tool-invocation-lifecycle";
import { ExternalActionClaimKinds, ExternalActionRecoveryModes, TOOL_INVOCATION_PREPARATION_POLICY, ToolInvocationLifecycleActions, ToolInvocationLifecycleEvents, ToolInvocationStates } from "./tool-invocation-lifecycle.types";
import { ToolResultDeliveryOutcomes, type ToolInvocationIntent, type ToolInvocationPreparationPolicy, type ToolResultDeliveryPayload } from "./tool-invocation.types";

/** Translate every database state name into the package's public state value. */
const _STATES_BY_PERSISTED_NAME: Readonly<Record<string, ToolInvocationStates>> = {
	Preparing: ToolInvocationStates.Preparing,
	AwaitingApproval: ToolInvocationStates.AwaitingApproval,
	Ready: ToolInvocationStates.Ready,
	Claimed: ToolInvocationStates.Claimed,
	Reconciling: ToolInvocationStates.Reconciling,
	Succeeded: ToolInvocationStates.Succeeded,
	Failed: ToolInvocationStates.Failed,
	RecoveryRequired: ToolInvocationStates.RecoveryRequired,
};

/** Translate every database recovery name into the package's public recovery value. */
const _RECOVERY_MODES_BY_PERSISTED_NAME: Readonly<Record<string, ExternalActionRecoveryModes>> = {
	ProviderIdempotency: ExternalActionRecoveryModes.ProviderIdempotency,
	Reconciliation: ExternalActionRecoveryModes.Reconciliation,
	Manual: ExternalActionRecoveryModes.Manual,
};

/** Translate every database claim name into the package's public claim value. */
const _CLAIM_KINDS_BY_PERSISTED_NAME: Readonly<Record<string, ExternalActionClaimKinds>> = {
	Dispatch: ExternalActionClaimKinds.Dispatch,
	Reconcile: ExternalActionClaimKinds.Reconcile,
};

/** Convert a stored state name into the lifecycle vocabulary. */
export function _ToolInvocationStateFromPersistence(state: string): ToolInvocationStates
{
	return _STATES_BY_PERSISTED_NAME[state];
}

/** Convert a stored recovery-mode name into the lifecycle vocabulary. */
export function _ToolInvocationRecoveryModeFromPersistence(mode: string): ExternalActionRecoveryModes
{
	return _RECOVERY_MODES_BY_PERSISTED_NAME[mode];
}

/** Convert a stored claim-kind name into the lifecycle vocabulary. */
export function _ToolInvocationClaimKindFromPersistence(kind: string | null): ExternalActionClaimKinds | null
{
	if (kind === null)
		return null;
	return _CLAIM_KINDS_BY_PERSISTED_NAME[kind];
}

/** Ask the lifecycle table which durable action one stored row permits. */
export function _ToolInvocationPlan(row: { readonly state: string; readonly recoveryMode: string; readonly claimKind: string | null; readonly preparationAttempt: number; readonly retryDeadlineAt: Date }, event: ToolInvocationLifecycleEvents, now: Date): ToolInvocationLifecycleActions
{
	return __PlanToolInvocationLifecycle({
		state: _ToolInvocationStateFromPersistence(row.state),
		event,
		recoveryMode: _ToolInvocationRecoveryModeFromPersistence(row.recoveryMode),
		claimKind: _ToolInvocationClaimKindFromPersistence(row.claimKind),
		preparationAttempt: row.preparationAttempt,
		preparationAttemptLimit: TOOL_INVOCATION_PREPARATION_POLICY.attemptLimit,
		withinPreparationDeadline: row.retryDeadlineAt.getTime() > now.getTime(),
	});
}

/** Validate the immutable provider recovery key contract before persistence. */
export function _ToolInvocationRecoveryKeyIsValid(intent: ToolInvocationIntent): boolean
{
	if (intent.recoveryMode === ExternalActionRecoveryModes.Manual)
		return intent.recoveryKey === null;
	return typeof intent.recoveryKey === "string" && intent.recoveryKey.length > 0 && intent.recoveryKey.length <= 256;
}

/** Require every caller to use the one approved provider-free preparation policy. */
export function _ToolInvocationPreparationPolicyIsFixed(policy: ToolInvocationPreparationPolicy): boolean
{
	return policy.attemptLimit === TOOL_INVOCATION_PREPARATION_POLICY.attemptLimit
		&& policy.retryWindowMilliseconds === TOOL_INVOCATION_PREPARATION_POLICY.retryWindowMilliseconds
		&& policy.retryDelayMilliseconds === TOOL_INVOCATION_PREPARATION_POLICY.retryDelayMilliseconds;
}

/** Restrict durable failure codes to bounded, non-secret machine categories. */
export function _ToolInvocationSafeFailureCode(failureCode: string): string
{
	return /^[a-z][a-z0-9_]{0,63}$/u.test(failureCode) ? failureCode : "external_action_failed";
}

/** Distinguish task ownership from AgentRun ownership. */
export function _ToolInvocationIsMcpTaskOwned(invocation: { readonly mcpTaskId?: string | null }): boolean
{
	return typeof invocation.mcpTaskId === "string";
}

/** Select the exact planner event for one claimed provider completion. */
export function _ToolInvocationCompletionEvent(kind: ExternalActionClaimKinds, outcome: ToolResultDeliveryPayload["outcome"]): ToolInvocationLifecycleEvents
{
	if (kind === ExternalActionClaimKinds.Dispatch && outcome === ToolResultDeliveryOutcomes.Succeeded)
		return ToolInvocationLifecycleEvents.DispatchSucceeded;
	if (kind === ExternalActionClaimKinds.Dispatch)
		return ToolInvocationLifecycleEvents.DispatchRejected;
	if (outcome === ToolResultDeliveryOutcomes.Succeeded)
		return ToolInvocationLifecycleEvents.ReconcileSucceeded;
	return ToolInvocationLifecycleEvents.ReconcileFailed;
}
