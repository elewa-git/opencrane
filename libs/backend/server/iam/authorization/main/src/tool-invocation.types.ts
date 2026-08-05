/** Request identity used by the tool-invocation repository for idempotent reserve-before-dispatch. */
export interface ToolInvocationIntent
{
	/** Silo in which the tool invocation is authoritative. */
	readonly siloId: string;
	/** Logical run proposing the external action. */
	readonly runId: string;
	/** Current positive run attempt. */
	readonly attempt: number;
	/** Stable AgentService identifier. */
	readonly agentServiceId: string;
	/** Immutable AgentRevision identifier. */
	readonly agentRevisionId: string;
	/** Subject whose grants authorised the run. */
	readonly subjectId: string;
	/** Immutable tool revision fixed by the run input snapshot. */
	readonly toolRevisionId: string;
	/** Runtime-supplied caller idempotency key for this invocation. */
	readonly toolInvocationId: string;
	/** Digest of the normalised and validated action arguments. */
	readonly argumentsDigest: string;
	/** Digest binding the exact validated tool revision and canonical arguments to this attempt. */
	readonly requestFingerprint: string;
	/** Whether the invocation must pause for a deferred approval before any dispatch. */
	readonly approvalRequired: boolean;
}

/** Canonical completed tool-invocation receipt retained under the caller idempotency key. */
export interface ToolInvocationReceipt<TResult>
{
	/** Runtime-supplied caller idempotency key that created the receipt. */
	readonly toolInvocationId: string;
	/** Fingerprint of the exact validated request that produced the result. */
	readonly requestFingerprint: string;
	/** Canonical result returned only for an allowed idempotent replay. */
	readonly result: TResult;
}

/** Atomic reservation result before external tool I/O begins. */
export type ToolInvocationReservationResult<TResult> =
	| { readonly status: "reserved"; readonly reservationId: string }
	| { readonly status: "existing_reserved" | "existing_failed" }
	| { readonly status: "existing_succeeded"; readonly receipt: ToolInvocationReceipt<TResult> };

/** Compare-and-set result when completing a reserved invocation successfully. */
export type ToolInvocationSuccessResult<TResult> =
	| { readonly status: "succeeded"; readonly receipt: ToolInvocationReceipt<TResult> }
	| { readonly status: "conflict" };

/** Compare-and-set result when completing a reserved invocation as failed. */
export type ToolInvocationFailureResult = { readonly status: "failed" | "conflict" };

/** Attempt-scoped coordinates that name exactly one durable tool-invocation reservation. */
export interface ToolInvocationCoordinates
{
	/** Logical run owning the reservation. */
	readonly runId: string;
	/** Positive attempt the reservation belongs to. */
	readonly attempt: number;
	/** Runtime-supplied caller idempotency key unique within the run attempt. */
	readonly toolInvocationId: string;
}

/** Persistence boundary that reserves before I/O and completes the durable receipt afterward. */
export interface ToolInvocationRepository
{
	/** Atomically creates a Reserved invocation or returns the existing durable idempotency state. */
	reserve<TResult>(intent: ToolInvocationIntent): Promise<ToolInvocationReservationResult<TResult>>;
	/** Atomically transitions the exact Reserved invocation to Succeeded with its canonical result. */
	markSucceeded<TResult>(reservationId: string, result: TResult): Promise<ToolInvocationSuccessResult<TResult>>;
	/** Atomically transitions the exact Reserved invocation to Failed with a stable internal code. */
	markFailed(reservationId: string, failureCode: string): Promise<ToolInvocationFailureResult>;
	/**
	 * Compare-and-set the unique Reserved invocation for `(runId, attempt, toolInvocationId)` to
	 * Succeeded with its canonical result. An absent, already-completed, or non-Reserved row is a
	 * conflict — the caller refuses the completion rather than duplicating a durable receipt.
	 */
	markSucceededByCoordinates<TResult>(coordinates: ToolInvocationCoordinates, result: TResult): Promise<ToolInvocationSuccessResult<TResult>>;
}
