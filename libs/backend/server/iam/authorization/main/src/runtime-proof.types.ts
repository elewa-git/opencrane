import type { CapabilityProofExpectation, CapabilityProofFailureReason } from "@opencrane/models/authorization";

/**
 * What happens when the exact same signed action is presented twice.
 *
 * `one_shot` denies the second attempt outright. `idempotent` returns the stored result of the
 * first execution, but only if the whole request still matches — same capability id, same request
 * fingerprint, same replay mode. Any difference is denied as `jti_replay`, so this cannot be used
 * to slip changed arguments past a completed action.
 *
 * Fixed by the first execution and stored on the receipt; a later call cannot change its mind.
 * @see {@link CapabilityActionReceipt}
 */
export type ActionReplayMode = "one_shot" | "idempotent";

/** Verified capability action submitted for exactly-once receipt handling. */
export interface ExecuteCapabilityActionCommand
{
	/** Compact ES256 DPoP-style proof presented by the runtime. */
	readonly compactProof: string;
	/** Trusted capability and observed HTTP request facts. */
	readonly expectation: CapabilityProofExpectation;
	/** Whether an identical replay denies or returns the canonical recorded result. */
	readonly replayMode: ActionReplayMode;
}

/** Request identity used by the receipt repository for capability-JTI replay control. */
export interface CapabilityActionIntent
{
	/** Proof-bound action capability identifier. */
	readonly jti: string;
	/** Digest binding the exact verified capability action and observed request. */
	readonly requestFingerprint: string;
	/** Explicit replay behavior for an identical request. */
	readonly replayMode: ActionReplayMode;
	/** Audience the proof must be addressed to. */
	readonly audience: string;
	/** Silo in which the capability is authoritative. */
	readonly siloId: string;
	/** Subject exercising the capability. */
	readonly subjectId: string;
	/** Projected Kubernetes service account. */
	readonly serviceAccountName: string;
	/** Exact Kubernetes namespace. */
	readonly namespace: string;
	/** Controller-owned workload kind. */
	readonly workloadKind: "job" | "deployment";
	/** Immutable controller workload UID. */
	readonly workloadUid: string;
	/** Immutable runtime Pod UID. */
	readonly podUid: string;
	/** Logical run identifier. */
	readonly runId: string;
	/** Current positive run attempt. */
	readonly attempt: number;
	/** Stable AgentService identifier. */
	readonly agentServiceId: string;
	/** Immutable AgentRevision identifier. */
	readonly agentRevisionId: string;
	/** RFC 7638 proof-key thumbprint registered to the workload. */
	readonly proofKeyThumbprint: string;
	/** Immutable capability catalog identifier. */
	readonly catalogId: string;
	/** Positive immutable capability catalog revision. */
	readonly catalogRevision: number;
	/** Digest of the immutable capability catalog. */
	readonly catalogDigest: string;
	/** Stable capability identifier within the catalog. */
	readonly capabilityId: string;
	/** Digest of the exact effective policy and grant set. */
	readonly effectivePolicyDigest: string;
	/** Exact resource kind being acted upon. */
	readonly resourceKind: string;
	/** Exact resource identifier being acted upon. */
	readonly resourceId: string;
	/** Exact action being performed. */
	readonly action: string;
	/** Digest of the RFC 8785 canonical action arguments. */
	readonly argumentsDigest: string;
}

/**
 * The actual external action, wrapped so it can only run after its reservation is committed.
 *
 * Passed in rather than called directly so the action runs outside every transaction — a long
 * external call must never hold a database transaction open.
 * @see {@link __ExecuteCapabilityAction}
 */
export interface CapabilityActionExecutor<TResult>
{
	/** Executes the external action outside the repository transaction. */
	execute(): Promise<TResult>;
}

/** Completed action receipt kept under the capability JTI. */
export interface CapabilityActionReceipt<TResult>
{
	/** Proof-bound action capability identifier that created the receipt. */
	readonly jti: string;
	/** Fingerprint of the exact verified request that produced the result. */
	readonly requestFingerprint: string;
	/** Replay policy fixed by the first execution. */
	readonly replayMode: ActionReplayMode;
	/** Canonical result returned only for allowed idempotent replays. */
	readonly result: TResult;
}

/** Atomic reservation result before external action I/O begins. */
export type CapabilityActionReservationResult<TResult> =
	| { readonly status: "reserved"; readonly reservationId: string }
	| { readonly status: "existing_reserved" | "existing_failed" }
	| { readonly status: "existing_succeeded"; readonly receipt: CapabilityActionReceipt<TResult> };

/** Compare-and-set result when completing a reserved action successfully. */
export type CapabilityActionSuccessResult<TResult> =
	| { readonly status: "succeeded"; readonly receipt: CapabilityActionReceipt<TResult> }
	| { readonly status: "conflict" };

/** Compare-and-set result when completing a reserved action as failed. */
export type CapabilityActionFailureResult = { readonly status: "failed" | "conflict" };

/**
 * Stores an action's intent before it runs, and its outcome after.
 *
 * The order is the whole point: `reserve` commits first, so a crash mid-action leaves a `Reserved`
 * row that blocks any retry instead of letting the action run twice. The external call then happens
 * OUTSIDE any transaction, and `markSucceeded` / `markFailed` close the row.
 *
 * `Atomically` is not used in these names because each method already runs as one transaction —
 * `reserve` relies on the unique `jti` database fence before deciding.
 * Implemented by: ./prisma-runtime-authority.ts (`PrismaRuntimeAuthorityRepository`).
 * @see {@link __ExecuteCapabilityAction} which is the only correct way to drive this order.
 */
export interface CapabilityActionReceiptRepository
{
	/**
	 * Claims the right to run this action, or reports that it is already claimed.
	 * @param intent - The verified action, including the `jti` this row is keyed by.
	 * @returns `reserved` with a `reservationId` — you may now perform the action. Any other status
	 *   means DO NOT perform it: `existing_reserved` (another caller is mid-flight or crashed),
	 *   `existing_failed` (already tried and failed), or `existing_succeeded` with the stored receipt,
	 *   which may be returned to the caller only for a matching idempotent replay.
	 * @throws When the verified proof key is not registered to any run, which means verification and
	 *   stored authority disagree.
	 */
	reserve<TResult>(intent: CapabilityActionIntent): Promise<CapabilityActionReservationResult<TResult>>;
	/**
	 * Stores the result of a completed action against its reservation.
	 * @param reservationId - Id returned by {@link CapabilityActionReceiptRepository.reserve}.
	 * @param result - Value stored for any later idempotent replay.
	 * @returns `succeeded` with the receipt, or `conflict` when the row is no longer `Reserved`.
	 *   A `conflict` here is serious: the action already happened but we could not record it, so the
	 *   caller must report an ambiguous outcome rather than retry.
	 */
	markSucceeded<TResult>(reservationId: string, result: TResult): Promise<CapabilityActionSuccessResult<TResult>>;
	/**
	 * Marks a reserved action as failed so it is never retried.
	 * @param reservationId - Id returned by {@link CapabilityActionReceiptRepository.reserve}.
	 * @param failureCode - Short internal code; never a provider message.
	 * @returns `failed` when recorded, `conflict` when the row is no longer `Reserved` — again an
	 *   ambiguous outcome, not a retry signal.
	 */
	markFailed(reservationId: string, failureCode: string): Promise<CapabilityActionFailureResult>;
}

/**
 * What happened to one signed action request.
 *
 * `executed` ran it now; `replayed` returned the stored result of an earlier identical request.
 * `denied` never performed the action — except for `action_execution_ambiguous`, which means the
 * action MAY have happened but we could not record the outcome. Treat that one as unresolved, never
 * as a failure, and never retry it.
 */
export type ExecuteCapabilityActionResult<TResult> =
	| { readonly outcome: "executed" | "replayed"; readonly receipt: CapabilityActionReceipt<TResult> }
	| { readonly outcome: "denied"; readonly reason: CapabilityProofFailureReason | "invalid_replay_mode" | "jti_replay" | "action_reservation_failed" | "action_execution_failed" | "action_execution_ambiguous" };
