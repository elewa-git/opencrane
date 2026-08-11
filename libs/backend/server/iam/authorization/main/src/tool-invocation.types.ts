import type { JsonValue } from "@opencrane/util";

import { TOOL_INVOCATION_PREPARATION_POLICY, type ExternalActionClaimKinds, type ExternalActionRecoveryModes, type ToolInvocationStates } from "./tool-invocation-lifecycle.types.js";

/** Retry limits for the preparation phase, which runs before any provider is called. */
export interface ToolInvocationPreparationPolicy
{
	/** Maximum provider-free preparation attempts. Production fixes this to three. */
	readonly attemptLimit: number;
	/** Hard window from admission in which provider-free preparation may retry. */
	readonly retryWindowMilliseconds: number;
	/** Delay before the next preparation claim may be attempted. */
	readonly retryDelayMilliseconds: number;
}

/** Runtime, command, and candidate ids stored with the invocation so it outlives the runtime process. */
export interface ToolInvocationRequestIdentity
{
	/** Runtime instance admitted by the current stream fence. */
	readonly runtimeInstanceId: string;
	/** Server-minted runtime command that caused the candidate. */
	readonly commandId: string;
	/** Runtime candidate id accepted atomically with this invocation. */
	readonly candidateId: string;
}

/** Everything about a proposed tool call that is written when the invocation is created in Preparing state. */
export interface ToolInvocationIntent
{
	/** Silo that owns the run and integration authority. */
	readonly siloId: string;
	/** Run that owns this invocation. */
	readonly runId: string;
	/** Positive run attempt fixed at admission. */
	readonly attempt: number;
	/** Agent service executed by the attempt. */
	readonly agentServiceId: string;
	/** Immutable agent revision executed by the attempt. */
	readonly agentRevisionId: string;
	/** Trusted execution subject from the immutable snapshot. */
	readonly subjectId: string;
	/** Admitted stream, command, and candidate identity. */
	readonly requestIdentity: ToolInvocationRequestIdentity;
	/** Immutable tool revision admitted from the compiled input. */
	readonly toolRevisionId: string;
	/** Runtime tool-call idempotency coordinate. */
	readonly toolInvocationId: string;
	/** Canonical validated arguments, not a later runtime replacement. */
	readonly arguments: JsonValue;
	/** Digest of the canonical validated arguments. */
	readonly argumentsDigest: string;
	/** Fingerprint binding the exact attempt, tool revision, invocation id, and argument digest. */
	readonly requestFingerprint: string;
	/** Whether provider dispatch must wait for authenticated approval. */
	readonly approvalRequired: boolean;
	/** What the adapter may do if a dispatch outcome is unknown; fixed before the first provider call. */
	readonly recoveryMode: ExternalActionRecoveryModes;
	/** Stable provider idempotency/readback key, present only when the trusted mode requires it. */
	readonly recoveryKey: string | null;
}

/** The stored ToolInvocation row as callers see it, returned after every conditional update. */
export interface ToolInvocationRecord
{
	/** Database identity used only inside trusted server packages. */
	readonly id: string;
	/** Silo in which the invocation authority is valid. */
	readonly siloId: string;
	/** Immutable agent revision that selected the tool. */
	readonly agentRevisionId: string;
	/** Trusted execution subject on whose behalf the action runs. */
	readonly subjectId: string;
	/** Run owning the invocation. */
	readonly runId: string;
	/** Attempt owning the invocation. */
	readonly attempt: number;
	/** Candidate id accepted with the invocation. */
	readonly candidateId: string;
	/** Runtime tool-call idempotency coordinate. */
	readonly toolInvocationId: string;
	/** Immutable tool revision. */
	readonly toolRevisionId: string;
	/** Canonical validated arguments. */
	readonly arguments: JsonValue;
	/** Canonical argument digest. */
	readonly argumentsDigest: string;
	/** Authenticated effective arguments after any approval edit. */
	readonly effectiveArguments: JsonValue;
	/** Digest of the authenticated effective arguments. */
	readonly effectiveArgumentsDigest: string;
	/** Immutable request fingerprint. */
	readonly requestFingerprint: string;
	/** Whether authenticated approval gates dispatch. */
	readonly approvalRequired: boolean;
	/** Frozen trusted-adapter recovery capability. */
	readonly recoveryMode: ExternalActionRecoveryModes;
	/** Frozen provider key when supported. */
	readonly recoveryKey: string | null;
	/** Current durable lifecycle state. */
	readonly state: ToolInvocationStates;
	/** Provider-free preparation attempts consumed. */
	readonly preparationAttempt: number;
	/** Hard provider-free retry deadline. */
	readonly retryDeadlineAt: Date;
	/** Earliest next provider-free preparation attempt. */
	readonly nextPreparationAttemptAt: Date;
	/** Monotonic provider claim attempt. */
	readonly claimAttempt: number;
	/** Current provider operation kind, or null while unclaimed. */
	readonly claimKind: ExternalActionClaimKinds | null;
	/** Monotonic provider claim fence. */
	readonly claimFence: number;
	/** Current provider claim lease expiry. */
	readonly claimExpiresAt: Date | null;
	/** Canonical result after success. */
	readonly result: JsonValue | null;
	/** Stable bounded failure code after failure. */
	readonly failureCode: string | null;
	/** Monotonic lifecycle compare-and-set revision. */
	readonly revision: number;
}

/** Result of atomic candidate and Preparing-invocation admission. */
export enum ToolInvocationAdmissionOutcomes
{
	/** A new preparing invocation became durable. */
	Admitted = "admitted",
	/** The exact invocation was already durable. */
	Idempotent = "idempotent",
	/** Existing durable authority disagreed with the candidate. */
	Conflict = "conflict",
}

/** Result of atomic candidate and Preparing-invocation admission. */
export type ToolInvocationAdmissionResult =
	| { readonly outcome: ToolInvocationAdmissionOutcomes.Admitted | ToolInvocationAdmissionOutcomes.Idempotent; readonly invocation: ToolInvocationRecord }
	| { readonly outcome: ToolInvocationAdmissionOutcomes.Conflict };

/** Proof that this worker may run one provider operation, for as long as its fence still matches the row. */
export interface ToolInvocationClaim
{
	/** Durable invocation identity. */
	readonly invocationId: string;
	/** Provider operation permitted by this claim. */
	readonly kind: ExternalActionClaimKinds;
	/** Monotonic fence checked by every completion. */
	readonly fence: number;
	/** Lifecycle revision observed after claim persistence. */
	readonly revision: number;
}

/** Outcome of claiming prepared work. */
export enum ToolInvocationClaimOutcomes
{
	/** This worker acquired the exact fenced provider claim. */
	Claimed = "claimed",
	/** Another durable transition already won. */
	Winner = "winner",
	/** The invocation no longer exists. */
	Missing = "missing",
}

/** Outcome of claiming prepared work. */
export type ToolInvocationClaimResult =
	| { readonly outcome: ToolInvocationClaimOutcomes.Claimed; readonly claim: ToolInvocationClaim; readonly invocation: ToolInvocationRecord }
	| { readonly outcome: ToolInvocationClaimOutcomes.Winner; readonly invocation: ToolInvocationRecord }
	| { readonly outcome: ToolInvocationClaimOutcomes.Missing };

/** Stable result categories delivered back to the runtime. */
export enum ToolResultDeliveryOutcomes
{
	/** The provider returned a canonical result. */
	Succeeded = "succeeded",
	/** The provider returned or proved a terminal failure. */
	Failed = "failed",
}

/** Result body stored for the runtime, written before the server creates the command that delivers it. */
export type ToolResultDeliveryPayload =
	| { readonly toolInvocationId: string; readonly outcome: "succeeded"; readonly result: JsonValue }
	| { readonly toolInvocationId: string; readonly outcome: "failed"; readonly failureCode: string };

/** Terminal CAS result; a loser must replay the returned durable winner instead of dispatching. */
export type ToolInvocationCompletionResult =
	| { readonly outcome: "completed"; readonly invocation: ToolInvocationRecord; readonly delivery: ToolResultDeliveryPayload }
	| { readonly outcome: "winner"; readonly invocation: ToolInvocationRecord }
	| { readonly outcome: "missing" };

/** Internal transaction result that distinguishes a winning CAS from an observed winner. */
export interface ToolInvocationTransitionResult
{
	/** Whether this transaction committed the lifecycle transition. */
	readonly changed: boolean;
	/** Durable invocation after the transition or losing comparison. */
	readonly invocation: ToolInvocationRecord | null;
}

/** Run-event kinds emitted by the server-owned external-action worker. */
export enum ToolInvocationEventTypes
{
	/** A fenced provider operation is about to begin. */
	Started = "tool.started",
	/** A provider result and its exact delivery intent committed successfully. */
	Completed = "tool.completed",
	/** A safe failure or retry status committed without exposing provider data. */
	Failed = "tool.failed",
}

/** Safe lifecycle event persisted by the invocation transaction owner. */
export type ToolInvocationLifecycleEvent =
	| { readonly runId: string; readonly attempt: number; readonly eventType: ToolInvocationEventTypes.Started; readonly payload: { readonly toolInvocationId: string } }
	| { readonly runId: string; readonly attempt: number; readonly eventType: ToolInvocationEventTypes.Completed; readonly payload: { readonly toolInvocationId: string } }
	| { readonly runId: string; readonly attempt: number; readonly eventType: ToolInvocationEventTypes.Failed; readonly payload: { readonly toolInvocationId: string; readonly toolRevisionId: string; readonly reason: string; readonly retryCount: number; readonly retryLimit: number; readonly retrying: boolean } };

/** Appends tool lifecycle events using the caller's transaction. */
export interface ToolInvocationLifecycleEventSink
{
	/** Append one lifecycle event in the invocation transition transaction. */
	appendInTransaction(transaction: unknown, event: ToolInvocationLifecycleEvent): Promise<boolean>;
}

/** Run event written when automatic recovery gives up and a person must decide what happened. */
export interface ToolInvocationRecoveryEvent
{
	/** Run entering its explicit recovery-required state. */
	readonly runId: string;
	/** Attempt fence visible to the cancellation API. */
	readonly expectedAttempt: number;
	/** Public runtime tool-call coordinate. */
	readonly toolInvocationId: string;
	/** Provider-free preparation attempts consumed before dispatch. */
	readonly preparationRetryCount: number;
	/** Fixed provider-free preparation attempt limit. */
	readonly preparationRetryLimit: typeof TOOL_INVOCATION_PREPARATION_POLICY.attemptLimit;
	/** Fixed safe classification, never a provider message or body. */
	readonly providerOutcome: "unknown_after_dispatch";
}

/**
 * Appends recovery events using the caller's transaction, so this package does not have to depend on the runs package.
 * @see ToolInvocationRunRecoveryAuthority
 */
export interface ToolInvocationRecoveryEventSink
{
	/** Append one recovery event in the invocation/run state transition transaction. */
	appendInTransaction(transaction: unknown, event: ToolInvocationRecoveryEvent): Promise<boolean>;
}

/** Run and attempt whose state may change, and only in the same transaction as an invocation entering recovery. */
export interface ToolInvocationRunRecoveryCommand
{
	/** Run whose automatic provider work is changing its recovery state. */
	readonly runId: string;
	/** Current attempt protected by the run-state compare-and-set. */
	readonly attempt: number;
}

/**
 * Stable runs-owned decisions returned inside a ToolInvocation recovery transaction.
 *
 * The serialized values cross the authorization-to-runs package boundary so callers can suppress
 * recovery events only for an already-cancelling run while treating every true conflict as fatal.
 */
export enum ToolInvocationRunRecoveryEnterResults
{
	/** This transaction moved the exact run attempt into manual recovery. */
	Entered = "entered",
	/** The exact run attempt was already in the required manual-recovery state. */
	AlreadyRecoveryRequired = "already_recovery_required",
	/** The exact run attempt is cancelling and must remain under cancellation authority. */
	Cancelling = "cancelling",
	/** The run identity, attempt, or state does not permit this recovery transition. */
	Conflict = "conflict",
}

/** Exact runs-owned decision when an invocation requires manual recovery. */
export type ToolInvocationRunRecoveryEnterResult = ToolInvocationRunRecoveryEnterResults;

/** Run-state operations the runs package provides, called inside this package's invocation transaction. */
export interface ToolInvocationRunRecoveryAuthority
{
	/** Enter visible manual recovery in the caller-owned invocation transaction. */
	enterRecoveryRequiredInTransaction(transaction: unknown, command: ToolInvocationRunRecoveryCommand): Promise<ToolInvocationRunRecoveryEnterResult>;
	/** Resume only after authorization proves no invocation still requires manual recovery. */
	resumeRunningInTransaction(transaction: unknown, command: ToolInvocationRunRecoveryCommand): Promise<boolean>;
}

/** Public UnitOfWork operations for one ToolInvocation-owned external-action lifecycle. */
interface ToolInvocationOperations
{
	/** Load one invocation from its accepted candidate coordinates. */
	findByCandidate(runId: string, attempt: number, candidateId: string): Promise<ToolInvocationRecord | null>;
	/** Return one invocation the worker may act on now, or null; only the run's current attempt qualifies. */
	findNextRunnable(now: Date): Promise<ToolInvocationRecord | null>;
	/** Record provider-free preparation success under the observed lifecycle revision. */
	markPrepared(invocationId: string, expectedRevision: number, now: Date): Promise<ToolInvocationRecord | null>;
	/** Consume one failed preparation attempt and append its canonical failure event atomically. */
	recordPreparationFailure(invocationId: string, expectedRevision: number, now: Date, policy: ToolInvocationPreparationPolicy, failureCode: string): Promise<ToolInvocationRecord | null>;
	/** Take a claim on the next provider operation, or return the stored row when another worker claimed it first. */
	claim(invocationId: string, kind: ExternalActionClaimKinds, now: Date, leaseMilliseconds: number): Promise<ToolInvocationClaimResult>;
	/** Complete success, delivery intent, and its canonical lifecycle event atomically. */
	completeSucceeded(claim: ToolInvocationClaim, result: JsonValue, now: Date): Promise<ToolInvocationCompletionResult>;
	/** Complete failure, delivery intent, and its canonical lifecycle event atomically. */
	completeFailed(claim: ToolInvocationClaim, failureCode: string, now: Date): Promise<ToolInvocationCompletionResult>;
	/** Apply ambiguous recovery policy and append its canonical lifecycle event atomically. */
	completeAmbiguous(claim: ToolInvocationClaim, now: Date): Promise<ToolInvocationRecord | null>;
	/** Release an exact claim after a pre-dispatch failure proved that no provider request started. */
	releaseClaimBeforeDispatch(claim: ToolInvocationClaim, now: Date): Promise<ToolInvocationRecord | null>;
	/** Apply frozen recovery policy to one expired provider claim without repeating its effect. */
	recoverExpiredClaim(invocationId: string, now: Date): Promise<ToolInvocationRecord | null>;
}

/** Process-scoped transaction owner that exposes the ToolInvocation lifecycle as atomic calls. */
export interface ToolInvocationUnitOfWork extends ToolInvocationOperations {}

/** Transaction-scoped persistence methods constructed only by the ToolInvocation unit of work. */
export interface ToolInvocationTransactionRepository
{
	/** Admit one candidate as durable Preparing work in the caller transaction. */
	admit(intent: ToolInvocationIntent, now: Date, policy: ToolInvocationPreparationPolicy): Promise<ToolInvocationAdmissionResult>;
	/** Load one invocation by its trusted database identity. */
	findById(invocationId: string): Promise<ToolInvocationRecord | null>;
	/** Load one invocation from its accepted candidate coordinates. */
	findByCandidate(runId: string, attempt: number, candidateId: string): Promise<ToolInvocationRecord | null>;
	/** Return one invocation the worker may act on now, or null; only the run's current attempt qualifies. */
	findNextRunnable(now: Date): Promise<ToolInvocationRecord | null>;
	/** Record provider-free preparation success under the observed lifecycle revision. */
	markPrepared(invocationId: string, expectedRevision: number, now: Date): Promise<ToolInvocationRecord | null>;
	/** Consume one failed provider-free preparation attempt. */
	recordPreparationFailure(invocationId: string, expectedRevision: number, now: Date, policy: ToolInvocationPreparationPolicy, failureCode: string): Promise<ToolInvocationTransitionResult>;
	/** Apply an authenticated approval and its effective arguments. */
	markApproved(invocationId: string, expectedArguments: JsonValue, expectedArgumentsDigest: string, effectiveArguments: JsonValue, effectiveArgumentsDigest: string): Promise<boolean>;
	/** Terminalise a rejected approval and create its exact failure delivery. */
	markApprovalRejected(invocationId: string, now: Date, failureCode: string): Promise<boolean>;
	/** Acquire one exact provider-operation claim. */
	claim(invocationId: string, kind: ExternalActionClaimKinds, now: Date, leaseMilliseconds: number): Promise<ToolInvocationClaimResult>;
	/** Complete one exact claim and persist its delivery. */
	complete(claim: ToolInvocationClaim, payload: ToolResultDeliveryPayload, now: Date): Promise<ToolInvocationCompletionResult>;
	/** Apply frozen recovery policy after an ambiguous provider outcome. */
	completeAmbiguous(claim: ToolInvocationClaim, now: Date): Promise<ToolInvocationTransitionResult>;
	/** Release an exact pre-dispatch claim under the bounded preparation policy. */
	releaseClaimBeforeDispatch(claim: ToolInvocationClaim, now: Date): Promise<ToolInvocationTransitionResult>;
	/** Recover one expired exact provider claim without repeating its effect. */
	recoverExpiredClaim(invocationId: string, now: Date): Promise<ToolInvocationTransitionResult>;
}

/** Stores new invocations inside the transaction that accepts the runtime's proposed tool calls. */
export interface ToolInvocationAdmissionUnitOfWork
{
	/** Admit one candidate as durable Preparing work through a transaction-bound repository. */
	admit(intent: ToolInvocationIntent, now: Date, policy: ToolInvocationPreparationPolicy): Promise<ToolInvocationAdmissionResult>;
}

/** Atomically admit one candidate as durable Preparing work inside the stream transaction. */
export type AdmitPreparingToolInvocation = (transaction: unknown, intent: ToolInvocationIntent, now: Date, policy: ToolInvocationPreparationPolicy) => Promise<ToolInvocationAdmissionResult>;
