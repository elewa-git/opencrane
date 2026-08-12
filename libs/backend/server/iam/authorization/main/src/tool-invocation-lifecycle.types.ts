/**
 * Fixed provider-free preparation policy shared by admission, scheduling, lifecycle, and events.
 *
 * A provider adapter has not started a request during this phase, so OpenCrane may try at most
 * three times within five minutes with a one-second delay. Every production owner consumes this
 * frozen value so durable state and user-visible retry evidence cannot drift.
 */
export const TOOL_INVOCATION_PREPARATION_POLICY = Object.freeze({ attemptLimit: 3, retryWindowMilliseconds: 300_000, retryDelayMilliseconds: 1_000 } as const);

/** Durable states owned by the external-action ToolInvocation authority. */
export enum ToolInvocationStates
{
	/** Candidate is durable but provider-free preparation has not completed. */
	Preparing = "preparing",
	/** Validated invocation is paused for an authenticated approval decision. */
	AwaitingApproval = "awaiting_approval",
	/** Prepared invocation may be claimed for provider dispatch. */
	Ready = "ready",
	/** One fenced worker owns the provider dispatch attempt. */
	Claimed = "claimed",
	/** One fenced worker may use trusted provider readback, never a blind dispatch. */
	Reconciling = "reconciling",
	/** Canonical result and its delivery intent are durable. */
	Succeeded = "succeeded",
	/** Proven terminal failure and its delivery intent are durable. */
	Failed = "failed",
	/** Provider outcome is ambiguous and requires an explicit operator decision. */
	RecoveryRequired = "recovery_required",
}

/** Recovery capability frozen from the trusted adapter before dispatch starts. */
export enum ExternalActionRecoveryModes
{
	/** The adapter guarantees repeated dispatches with the same key have one provider effect. */
	ProviderIdempotency = "provider_idempotency",
	/** The adapter can read the provider outcome without repeating the effect. */
	Reconciliation = "reconciliation",
	/** The adapter supports neither safe redispatch nor provider readback. */
	Manual = "manual",
}

/** Provider operation protected by the current monotonic invocation claim. */
export enum ExternalActionClaimKinds
{
	/** Claim permits exactly one adapter dispatch call. */
	Dispatch = "dispatch",
	/** Claim permits only the adapter's non-mutating provider readback. */
	Reconcile = "reconcile",
}

/** Events interpreted by the ToolInvocation state owner. */
export enum ToolInvocationLifecycleEvents
{
	/** Provider-free preparation completed and no approval is required. */
	Prepared = "prepared",
	/** Provider-free preparation completed but approval is required. */
	PreparedForApproval = "prepared_for_approval",
	/** Internal preparation failed before any provider adapter dispatch began. */
	PreparationFailed = "preparation_failed",
	/** Authenticated reviewer approved the validated invocation. */
	Approved = "approved",
	/** Authenticated reviewer denied or the approval expired. */
	ApprovalRejected = "approval_rejected",
	/** Worker acquired a monotonic dispatch claim. */
	DispatchClaimed = "dispatch_claimed",
	/** Provider returned a definite successful result. */
	DispatchSucceeded = "dispatch_succeeded",
	/** Provider returned a definite terminal refusal. */
	DispatchRejected = "dispatch_rejected",
	/** Adapter proved that no provider request left the process. */
	DispatchProvenNotStarted = "dispatch_proven_not_started",
	/** Dispatch began but its provider outcome cannot be proven. */
	DispatchAmbiguous = "dispatch_ambiguous",
	/** A dispatch claim lease expired without proving a provider outcome. */
	DispatchClaimExpired = "dispatch_claim_expired",
	/** Worker acquired a monotonic provider-readback claim. */
	ReconcileClaimed = "reconcile_claimed",
	/** Provider readback confirmed successful completion. */
	ReconcileSucceeded = "reconcile_succeeded",
	/** Provider readback confirmed terminal failure. */
	ReconcileFailed = "reconcile_failed",
	/** Provider readback proved the effect never occurred. */
	ReconcileAbsent = "reconcile_absent",
	/** Provider readback could not establish an outcome. */
	ReconcileInconclusive = "reconcile_inconclusive",
	/** Adapter proved no provider readback request started after claiming reconciliation. */
	ReconcileProvenNotStarted = "reconcile_proven_not_started",
	/** A non-mutating reconciliation claim expired before its result became durable. */
	ReconcileClaimExpired = "reconcile_claim_expired",
	/** Server-authoritative cancellation closed the invocation. */
	Cancelled = "cancelled",
}

/** State-owned persistence decision selected before any strategy code runs. */
export enum ToolInvocationLifecycleActions
{
	/** Transition provider-free preparation to Ready. */
	MarkReady = "mark_ready",
	/** Transition provider-free preparation to AwaitingApproval. */
	AwaitApproval = "await_approval",
	/** Retry internal preparation under the durable attempt/deadline budget. */
	RetryPreparation = "retry_preparation",
	/** Terminalise a proven preparation, approval, provider, or cancellation failure. */
	Fail = "fail",
	/** Transition approved work to Ready. */
	Approve = "approve",
	/** Transition Ready to a fenced Claimed dispatch. */
	ClaimDispatch = "claim_dispatch",
	/** Complete success and create the exact result-delivery intent atomically. */
	Succeed = "succeed",
	/** Return a proven-not-started dispatch to Ready within its preparation budget. */
	Redispatch = "redispatch",
	/** Repeat dispatch only with the exact frozen provider idempotency key. */
	RedispatchIdempotently = "redispatch_idempotently",
	/** Move ambiguous work to provider readback without repeating its effect. */
	BeginReconciliation = "begin_reconciliation",
	/** Stop automatic provider work and expose an explicit recovery-required state. */
	RequireManualRecovery = "require_manual_recovery",
	/** Acquire a fenced reconciliation claim. */
	ClaimReconciliation = "claim_reconciliation",
	/** Return a proven-not-started or expired readback claim to unclaimed reconciliation. */
	RetryReconciliation = "retry_reconciliation",
	/** Reject an invalid State x Event combination without mutation. */
	Reject = "reject",
}

/** Complete input needed for one deterministic State x Event decision. */
export interface ToolInvocationLifecycleInput
{
	/** Durable state observed under the invocation CAS revision. */
	readonly state: ToolInvocationStates;
	/** Lifecycle event being applied. */
	readonly event: ToolInvocationLifecycleEvents;
	/** Frozen trusted-adapter recovery capability. */
	readonly recoveryMode: ExternalActionRecoveryModes;
	/** Active exact provider claim, or null when no provider I/O may still be in flight. */
	readonly claimKind: ExternalActionClaimKinds | null;
	/** Number of provider-free preparation attempts already consumed. */
	readonly preparationAttempt: number;
	/** Maximum provider-free preparation attempts, fixed at three in production. */
	readonly preparationAttemptLimit: number;
	/** Whether the trusted server instant is still inside the five-minute retry window. */
	readonly withinPreparationDeadline: boolean;
}
