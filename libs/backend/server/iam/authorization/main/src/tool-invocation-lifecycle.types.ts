/**
 * Fixed provider-free preparation policy shared by admission, scheduling, lifecycle, and events.
 *
 * A provider adapter has not started a request during this phase, so OpenCrane may try at most
 * three times within five minutes with a one-second delay. Every production owner consumes this
 * frozen value so durable state and user-visible retry evidence cannot drift.
 */
export const TOOL_INVOCATION_PREPARATION_POLICY = Object.freeze({ attemptLimit: 3, retryWindowMilliseconds: 300_000, retryDelayMilliseconds: 1_000 } as const);

/**
 * The states one external tool call moves through in the database.
 *
 * Read this as three groups. Nothing has touched the provider yet in `Preparing`,
 * `AwaitingApproval`, or `Ready`. Exactly one worker may be talking to the provider right now in
 * `Claimed` (a real dispatch) or `Reconciling` (a read-only "did it happen?" check). `Succeeded`,
 * `Failed`, and `RecoveryRequired` are the end of the line for the worker.
 *
 * The two pairs callers get wrong:
 * - `Claimed` vs `Reconciling`. Both mean a claim is held, but `Claimed` permits one mutating
 *   dispatch and `Reconciling` permits only a read. Treat `Reconciling` as if it were `Claimed`
 *   and you re-fire an action the provider may already have performed.
 * - `Failed` vs `RecoveryRequired`. `Failed` means we know the action did not take effect and a
 *   result was delivered to the runtime. `RecoveryRequired` means we do NOT know: the provider may
 *   have done the work. Reporting `RecoveryRequired` as a failure tells the user nothing happened
 *   when money may already have moved. No automatic retry is allowed from that state; a person
 *   must decide.
 *
 * Only `Cancelled` events are accepted once a state is terminal, and only server-side
 * cancellation may send one.
 * @see {@link ToolInvocationLifecycleActions} for the write each State x Event pair permits.
 * @see {@link ExternalActionRecoveryModes} for what decides between reconcile, redispatch, and
 *   manual recovery.
 */
export enum ToolInvocationStates
{
	/** The invocation is stored, but the work that runs before any provider call is not finished. */
	Preparing = "preparing",
	/** Validated invocation is paused for an authenticated approval decision. */
	AwaitingApproval = "awaiting_approval",
	/** Prepared invocation may be claimed for provider dispatch. */
	Ready = "ready",
	/** One fenced worker owns the provider dispatch attempt. */
	Claimed = "claimed",
	/** One worker may ask the provider what happened, but must not send the action again. */
	Reconciling = "reconciling",
	/** Canonical result and its delivery intent are durable. */
	Succeeded = "succeeded",
	/** Proven terminal failure and its delivery intent are durable. */
	Failed = "failed",
	/** Provider outcome is ambiguous and requires an explicit operator decision. */
	RecoveryRequired = "recovery_required",
}

/**
 * What the tool adapter can do for us if a dispatch ends with an unknown outcome.
 *
 * This is read from the adapter and written onto the invocation row BEFORE the first provider
 * call, so a later crash cannot change the answer to "how do we clean up?". When a dispatch
 * result is ambiguous, this value alone decides the next state:
 * - `ProviderIdempotency` -> go back to `Ready` and send the same request again with the stored
 *   `recoveryKey`, because a duplicate cannot double-charge.
 * - `Reconciliation` -> go to `Reconciling` and ask the provider what happened; never redispatch.
 * - `Manual` -> go to `RecoveryRequired` and stop; a person decides.
 *
 * `Manual` requires `recoveryKey` to be null; the other two require a non-empty key (enforced by
 * `_recoveryKeyIsValid` in prisma-tool-invocation-repository.ts). Pick a mode the adapter cannot
 * actually honour and you either duplicate a real-world effect or strand a run.
 * @see {@link ToolInvocationStates}
 */
export enum ExternalActionRecoveryModes
{
	/** The adapter guarantees repeated dispatches with the same key have one provider effect. */
	ProviderIdempotency = "provider_idempotency",
	/** The adapter can read the provider outcome without repeating the effect. */
	Reconciliation = "reconciliation",
	/** The adapter supports neither safe redispatch nor provider readback. */
	Manual = "manual",
}

/** Which provider operation the current claim allows. */
export enum ExternalActionClaimKinds
{
	/** Claim permits exactly one adapter dispatch call. */
	Dispatch = "dispatch",
	/** Claim permits only the adapter's non-mutating provider readback. */
	Reconcile = "reconcile",
}

/**
 * Things that happen to one tool call, fed into {@link __PlanToolInvocationLifecycle}.
 *
 * Each member is a fact already established by the caller — preparation finished, the provider
 * answered, a lease expired — never a request for a transition. The planner turns a
 * state-plus-event pair into a {@link ToolInvocationLifecycleActions} member.
 */
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

/** The database change to make, chosen before any provider code runs. */
export enum ToolInvocationLifecycleActions
{
	/** Transition provider-free preparation to Ready. */
	MarkReady = "mark_ready",
	/** Transition provider-free preparation to AwaitingApproval. */
	AwaitApproval = "await_approval",
	/** Retry internal preparation under the durable attempt/deadline budget. */
	RetryPreparation = "retry_preparation",
	/** Terminalise a preparation, approval, provider, or cancellation failure that is already confirmed. */
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

/**
 * Everything {@link __PlanToolInvocationLifecycle} needs to pick the next write.
 *
 * Deliberately plain data with no database or clock access, so the decision can be unit-tested
 * and replayed. The caller reads all of it from the invocation row it holds under a revision
 * check, and computes `withinPreparationDeadline` from the trusted server clock rather than
 * passing a clock in.
 */
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
