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
	/** Id the runtime gave this tool call; repeat calls with the same id must not run twice. */
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
	/** Id the runtime gave this tool call; repeat calls with the same id must not run twice. */
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

/**
 * What admission decided for one candidate.
 *
 * `admitted` created the row; `idempotent` found the identical row from an earlier attempt — both
 * carry the invocation and both mean "proceed". `conflict` carries nothing and is permanent: the
 * candidate id already belongs to different arguments, the request fingerprint is already taken,
 * or the preparation policy was not the fixed one. Do not retry a `conflict`.
 */
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

/**
 * What happened when a worker tried to take the lease on one invocation.
 *
 * `claimed` means this worker holds the lease and may make exactly one provider call, using the
 * returned `claim`. `winner` means another worker already moved this invocation, or its state no
 * longer permits the claim — the row that won is returned so the caller can carry on from the real
 * state instead of retrying. `missing` means the invocation row is gone.
 *
 * Making a provider call after anything other than `claimed` risks a duplicate real-world effect.
 * @see {@link ToolInvocationClaim}
 */
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

/**
 * What happened when a worker tried to record a finished provider call.
 *
 * `completed` means this worker's result was stored and `delivery` is the exact body to hand back
 * to the runtime. `winner` means another worker recorded the outcome first: the returned row is
 * the stored truth, and the caller must deliver from that row rather than send its own result or
 * call the provider again. `missing` means the invocation row is gone.
 */
export type ToolInvocationCompletionResult =
	| { readonly outcome: "completed"; readonly invocation: ToolInvocationRecord; readonly delivery: ToolResultDeliveryPayload }
	| { readonly outcome: "winner"; readonly invocation: ToolInvocationRecord }
	| { readonly outcome: "missing" };

/**
 * Whether this transaction actually changed the invocation, and the row as it now stands.
 *
 * `changed` is true only when this caller's conditional update matched one row. False means the
 * row moved under us — usually another worker got there first — and `invocation` is then the
 * current stored row, not what we tried to write. Only a caller with `changed: true` may append
 * the timeline event for the transition, otherwise the same event would be written twice.
 */
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
	/**
	 * Adds one timeline event using the caller's open transaction.
	 * @param transaction - The Prisma transaction that is committing the state change. Typed
	 *   `unknown` on purpose so this package never imports Prisma types from the runs package.
	 * @param event - Event to append; carries no arguments and no provider response.
	 * @returns True when the event was written. False means the run rejected it (wrong attempt or a
	 *   run state that does not accept this kind), and the caller MUST abort the whole transition —
	 *   ./prisma-tool-invocation-unit-of-work.ts throws so the transaction rolls back.
	 */
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
	/**
	 * Adds one manual-recovery entry using the caller's open transaction.
	 * @param transaction - The Prisma transaction moving the invocation into `RecoveryRequired`.
	 * @param event - Fixed, non-secret summary; never a provider message or body.
	 * @returns True when the entry was written. False means the caller must abort the transition, so
	 *   an invocation can never reach `RecoveryRequired` invisibly.
	 */
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
 * What the runs package answers when this package asks to move a run into manual recovery.
 *
 * The caller must react differently to each one, and ./prisma-tool-invocation-unit-of-work.ts
 * (`_enterRecoveryRequired`) does:
 * - `Entered` and `AlreadyRecoveryRequired` -> write the recovery entry and commit. The second is
 *   a replay after a retried transaction, not an error.
 * - `Cancelling` -> commit the invocation change but write NO recovery entry. The run is already
 *   being torn down, and a recovery entry would ask a person to act on work that is going away.
 *   The cleared provider claim still commits so cancellation can finish without repeating the
 *   provider call.
 * - `Conflict` -> throw. The run id, attempt, or state does not match, which means we are looking
 *   at the wrong attempt; committing anyway would strand a run in the wrong state.
 *
 * These are string values on purpose because they cross a package boundary.
 * Called by: libs/backend/agents/execution/runs/main/src/prisma-tool-invocation-run-recovery-authority.ts
 * (returns them) and ./prisma-tool-invocation-unit-of-work.ts (branches on them).
 * @see {@link ToolInvocationRunRecoveryAuthority}
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
	/**
	 * Moves one run attempt into its manual-recovery state.
	 * @param transaction - The Prisma transaction already changing the invocation. Typed `unknown`
	 *   so this package holds no Prisma dependency from the runs side.
	 * @param command - The run id and the attempt the caller believes is current; the runs package
	 *   checks the attempt itself and answers `Conflict` if it moved on.
	 * @returns Which of the four {@link ToolInvocationRunRecoveryEnterResults} happened. The caller
	 *   must branch on all four — see that enum for what each one obliges it to do.
	 */
	enterRecoveryRequiredInTransaction(transaction: unknown, command: ToolInvocationRunRecoveryCommand): Promise<ToolInvocationRunRecoveryEnterResult>;
	/**
	 * Puts a recovered run attempt back to running.
	 *
	 * Only legal once no invocation on that attempt is still in `RecoveryRequired` — resuming while
	 * one is unresolved would let the worker pick up an action whose real-world outcome is still
	 * unknown. The caller is responsible for that check; this port does not make it.
	 * @param transaction - The Prisma transaction performing the resume.
	 * @param command - Run id and the attempt expected to still be current.
	 * @returns True when the run moved back to running. False when the attempt or state no longer
	 *   matches, which the caller must treat as "someone else changed this run".
	 * Called by: no caller in this repo yet — only the runs-side implementation and its tests
	 * (libs/backend/agents/execution/runs/main/src/prisma-tool-invocation-run-recovery-authority.ts).
	 */
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

/**
 * The public way to move one tool call along; each method is its own transaction.
 *
 * Callers hold no transaction and never see Prisma. One call = one serializable transaction that
 * changes the invocation, writes its result delivery if there is one, and appends its timeline
 * event, so a partially applied transition cannot be observed. Methods that can lose a race
 * return the durable row that won instead of throwing, and the caller must accept that row rather
 * than retry its own intent.
 *
 * Called by: libs/backend/agents/execution/protocol/src/external-action-worker.types.ts (as the
 * worker's `invocations` dependency); composed in
 * apps/opencrane/src/app/external-action-composition.ts.
 * Implemented by: ./prisma-tool-invocation-unit-of-work.ts.
 */
export interface ToolInvocationUnitOfWork extends ToolInvocationOperations {}

/**
 * Every database write for one tool call, all bound to a single open transaction.
 *
 * Only {@link ToolInvocationUnitOfWork} may build one of these, because each method assumes it is
 * already inside a serializable transaction and enforces its own optimistic check (expected
 * `revision`, or an exact claim `fence`) in the WHERE clause. Every method here asks the pure
 * planner first and refuses to write a transition the planner did not choose.
 *
 * Implemented by: ./prisma-tool-invocation-repository.ts (`PrismaToolInvocationRepository`).
 * @see {@link ToolInvocationUnitOfWork} for the process-level entry point callers actually use.
 */
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

/**
 * Records one accepted tool-call candidate as a new invocation in `Preparing`.
 *
 * Passed as a function so the runtime-stream code can admit an invocation without importing this
 * package's Prisma adapter. It runs inside the caller's transaction, so it commits with the
 * candidate acceptance.
 *
 * Idempotent on `(runId, attempt, candidateId)`: a repeat with the same `requestFingerprint`
 * returns `idempotent` with the existing row, and a repeat with a different fingerprint returns
 * `conflict` and writes nothing. A caller that treats `conflict` as retryable will spin forever —
 * it means the same candidate id is being reused for different arguments.
 *
 * Called by: libs/backend/agents/execution/protocol/src/prisma-runtime-dispatch-authority.ts.
 * Implemented by: `__AdmitPreparingToolInvocationInTransaction` in
 * ./prisma-tool-invocation-repository.ts.
 * @param transaction - Prisma transaction accepting the runtime candidate, typed `unknown` to keep
 *   Prisma out of this contract.
 * @param intent - The frozen candidate facts to persist.
 * @param now - Trusted server time; sets the retry deadline.
 * @param policy - Must be exactly {@link TOOL_INVOCATION_PREPARATION_POLICY}; any other value is
 *   rejected as `conflict`.
 * @returns `admitted` for a new row, `idempotent` for an exact replay, `conflict` for anything else.
 */
export type AdmitPreparingToolInvocation = (transaction: unknown, intent: ToolInvocationIntent, now: Date, policy: ToolInvocationPreparationPolicy) => Promise<ToolInvocationAdmissionResult>;
