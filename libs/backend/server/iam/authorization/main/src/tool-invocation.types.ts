import type { JsonValue } from "@opencrane/util";

import type { ExternalActionClaimKinds, ExternalActionRecoveryModes, ToolInvocationStates } from "./tool-invocation-lifecycle.types.js";

/** Fixed product policy for provider-free preparation recovery. */
export interface ToolInvocationPreparationPolicy
{
	/** Maximum provider-free preparation attempts. Production fixes this to three. */
	readonly attemptLimit: number;
	/** Hard window from admission in which provider-free preparation may retry. */
	readonly retryWindowMilliseconds: number;
	/** Delay before the next preparation claim may be attempted. */
	readonly retryDelayMilliseconds: number;
}

/** Trusted request identity persisted with one candidate before runtime memory is discarded. */
export interface ToolInvocationRequestIdentity
{
	/** Runtime instance admitted by the current stream fence. */
	readonly runtimeInstanceId: string;
	/** Server-minted runtime command that caused the candidate. */
	readonly commandId: string;
	/** Runtime candidate id accepted atomically with this invocation. */
	readonly candidateId: string;
}

/** Complete immutable candidate authority persisted in Preparing state. */
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
	/** Trusted-adapter recovery capability frozen before any provider dispatch begins. */
	readonly recoveryMode: ExternalActionRecoveryModes;
	/** Stable provider idempotency/readback key, present only when the trusted mode requires it. */
	readonly recoveryKey: string | null;
}

/** Durable ToolInvocation projection returned after every CAS decision. */
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
export type ToolInvocationAdmissionResult =
	| { readonly outcome: "admitted" | "idempotent"; readonly invocation: ToolInvocationRecord }
	| { readonly outcome: "conflict" };

/** Fenced claim that permits exactly one provider strategy operation. */
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
export type ToolInvocationClaimResult =
	| { readonly outcome: "claimed"; readonly claim: ToolInvocationClaim; readonly invocation: ToolInvocationRecord }
	| { readonly outcome: "winner"; readonly invocation: ToolInvocationRecord }
	| { readonly outcome: "missing" };

/** Exact runtime tool-result delivery body persisted before command minting. */
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

/** Canonical run-event kinds emitted by the server-owned external-action worker. */
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
	| { readonly runId: string; readonly attempt: number; readonly eventType: ToolInvocationEventTypes.Failed; readonly payload: { readonly toolInvocationId: string; readonly reason: string; readonly retryCount: number; readonly retryLimit: number; readonly retrying: boolean } };

/** Transaction-bound sink for canonical tool lifecycle events. */
export interface ToolInvocationLifecycleEventSink
{
	/** Append one lifecycle event in the invocation transition transaction. */
	appendInTransaction(transaction: unknown, event: ToolInvocationLifecycleEvent): Promise<boolean>;
}

/** Safe server-owned evidence appended when automatic provider recovery cannot continue. */
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
	readonly preparationRetryLimit: 3;
	/** Fixed safe classification, never a provider message or body. */
	readonly providerOutcome: "unknown_after_dispatch";
}

/** Transaction-bound canonical event sink injected without reversing domain ownership. */
export interface ToolInvocationRecoveryEventSink
{
	/** Append one recovery event in the invocation/run state transition transaction. */
	appendInTransaction(transaction: unknown, event: ToolInvocationRecoveryEvent): Promise<boolean>;
}

/** Exact run-attempt coordinate changed only beside a ToolInvocation recovery transition. */
export interface ToolInvocationRunRecoveryCommand
{
	/** Run whose automatic provider work is changing recovery posture. */
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

/** Runs-owned state port injected into the authorization-owned invocation transaction. */
export interface ToolInvocationRunRecoveryAuthority
{
	/** Enter visible manual recovery in the caller-owned invocation transaction. */
	enterRecoveryRequiredInTransaction(transaction: unknown, command: ToolInvocationRunRecoveryCommand): Promise<ToolInvocationRunRecoveryEnterResult>;
	/** Resume only after authorization proves no invocation still requires manual recovery. */
	resumeRunningInTransaction(transaction: unknown, command: ToolInvocationRunRecoveryCommand): Promise<boolean>;
}

/** Persistence authority for one ToolInvocation-owned external-action lifecycle. */
export interface ToolInvocationRepository
{
	/** Load one invocation from its accepted candidate coordinates. */
	findByCandidate(runId: string, attempt: number, candidateId: string): Promise<ToolInvocationRecord | null>;
	/** Return at most one invocation whose exact current run attempt permits worker progress. */
	findNextRunnable(now: Date): Promise<ToolInvocationRecord | null>;
	/** Record provider-free preparation success under the observed lifecycle revision. */
	markPrepared(invocationId: string, expectedRevision: number, now: Date): Promise<ToolInvocationRecord | null>;
	/** Consume one failed provider-free preparation attempt without granting dispatch. */
	recordPreparationFailure(invocationId: string, expectedRevision: number, now: Date, policy: ToolInvocationPreparationPolicy, failureCode: string): Promise<ToolInvocationRecord | null>;
	/** Consume one preparation failure and append its safe failure event atomically. */
	recordPreparationFailureWithEvent(invocationId: string, expectedRevision: number, now: Date, policy: ToolInvocationPreparationPolicy, failureCode: string): Promise<ToolInvocationRecord | null>;
	/** Acquire a monotonic provider operation claim or return the durable CAS winner. */
	claim(invocationId: string, kind: ExternalActionClaimKinds, now: Date, leaseMilliseconds: number): Promise<ToolInvocationClaimResult>;
	/** Complete a claimed success and create its one-to-one delivery intent atomically. */
	completeSucceeded(claim: ToolInvocationClaim, result: JsonValue, now: Date): Promise<ToolInvocationCompletionResult>;
	/** Complete success, result delivery, and the canonical completion event atomically. */
	completeSucceededWithEvent(claim: ToolInvocationClaim, result: JsonValue, now: Date): Promise<ToolInvocationCompletionResult>;
	/** Complete a claimed proven failure and create its one-to-one delivery intent atomically. */
	completeFailed(claim: ToolInvocationClaim, failureCode: string, now: Date): Promise<ToolInvocationCompletionResult>;
	/** Complete failure, result delivery, and the canonical failure event atomically. */
	completeFailedWithEvent(claim: ToolInvocationClaim, failureCode: string, now: Date): Promise<ToolInvocationCompletionResult>;
	/** Apply recovery-mode policy after an ambiguous provider outcome, with no result delivery. */
	completeAmbiguous(claim: ToolInvocationClaim, now: Date): Promise<ToolInvocationRecord | null>;
	/** Apply ambiguous recovery policy and append its safe failure event atomically. */
	completeAmbiguousWithEvent(claim: ToolInvocationClaim, now: Date): Promise<ToolInvocationRecord | null>;
	/** Release an exact claim after a pre-dispatch failure proved that no provider request started. */
	releaseClaimBeforeDispatch(claim: ToolInvocationClaim, now: Date): Promise<ToolInvocationRecord | null>;
	/** Apply frozen recovery policy to one expired provider claim without repeating its effect. */
	recoverExpiredClaim(invocationId: string, now: Date): Promise<ToolInvocationRecord | null>;
}

/** Process-scoped transaction owner that exposes the ToolInvocation lifecycle as atomic calls. */
export interface ToolInvocationUnitOfWork extends ToolInvocationRepository {}

/** Transaction-scoped persistence methods constructed only by the ToolInvocation unit of work. */
export interface ToolInvocationTransactionRepository
{
	/** Admit one candidate as durable Preparing work in the caller transaction. */
	admit(intent: ToolInvocationIntent, now: Date, policy: ToolInvocationPreparationPolicy): Promise<ToolInvocationAdmissionResult>;
	/** Load one invocation by its trusted database identity. */
	findById(invocationId: string): Promise<ToolInvocationRecord | null>;
	/** Load one invocation from its accepted candidate coordinates. */
	findByCandidate(runId: string, attempt: number, candidateId: string): Promise<ToolInvocationRecord | null>;
	/** Return at most one invocation whose exact current run attempt permits worker progress. */
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

/** Transaction-bound admission owner used by the runtime candidate acceptance transaction. */
export interface ToolInvocationAdmissionUnitOfWork
{
	/** Admit one candidate as durable Preparing work through a transaction-bound repository. */
	admit(intent: ToolInvocationIntent, now: Date, policy: ToolInvocationPreparationPolicy): Promise<ToolInvocationAdmissionResult>;
}

/** Atomically admit one candidate as durable Preparing work inside the stream transaction. */
export type AdmitPreparingToolInvocation = (transaction: unknown, intent: ToolInvocationIntent, now: Date, policy: ToolInvocationPreparationPolicy) => Promise<ToolInvocationAdmissionResult>;
