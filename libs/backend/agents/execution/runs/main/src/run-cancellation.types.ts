/** A user-authorised request to fence the run's current attempt. */
export interface RequestRunCancellationCommand
{
	/** Logical run being cancelled. */
	readonly runId: string;
	/** Attempt observed by the caller; stale attempts cannot cancel newer work. */
	readonly expectedAttempt: number;
	/** Authenticated user or service subject recorded in the durable cancellation request. */
	readonly requestedBy: string;
}

/**
 * Describes whether cancellation is still waiting for its durable workflow to remove physical work.
 *
 * A fresh accepted request returns Cancelling while the workflow owns exact warm-runtime deletion
 * and finalization. A retry returns Idempotent with the saved cancelling or cancelled state. These
 * values are in-memory API outcomes, separate from the persisted Prisma AgentRunState enum even
 * when their strings match.
 *
 * @see RequestRunCancellationResult for the payload carried with each status.
 * @see RunCancellationConflictReasons for why a Conflict was refused.
 */
export enum RunCancellationResultStatuses
{
	/** The attempt is fenced and its durable workflow still owes cleanup and finalization. */
	Cancelling = "cancelling",
	/** This same cancellation already happened, so this call changed nothing. */
	Idempotent = "idempotent",
	/** No run exists with that id. */
	NotFound = "not_found",
	/** The run exists but cannot be cancelled as asked. */
	Conflict = "conflict",
}

/** Names why one cancellation request was refused. */
export enum RunCancellationConflictReasons
{
	/** The command was malformed. */
	InvalidRequest = "invalid_request",
	/** The caller named an attempt that is no longer current. */
	AttemptConflict = "attempt_conflict",
	/** The run already completed or failed. */
	TerminalRun = "terminal_run",
	/** The run and its bound workflow task did not name the same current authority. */
	AuthorityConflict = "authority_conflict",
}

/** Durable outcome of requesting cancellation. */
export type RequestRunCancellationResult =
	| { readonly status: "cancelling"; readonly runId: string; readonly attempt: number }
	| { readonly status: "idempotent"; readonly runId: string; readonly attempt: number; readonly state: "cancelling" | "cancelled" }
	| { readonly status: "not_found" }
	| { readonly status: "conflict"; readonly reason: "invalid_request" | "attempt_conflict" | "terminal_run" | "authority_conflict" };

/** Persists cancellation inside the serializable transaction opened by its caller. */
export interface RunCancellationPersistenceRepository
{
	/** Revoke the current attempt and publish its durable workflow cancellation event. */
	requestCancellation(command: RequestRunCancellationCommand, now: Date): Promise<RequestRunCancellationResult>;
}

/** Owns the database transaction for a user-authorised AgentRun cancellation. */
export interface RunCancellationRepository
{
	/**
	 * Fence the named attempt and ask its durable workflow to remove physical work.
	 *
	 * @param command - Run, expected attempt, and authenticated requester.
	 * @returns The accepted, repeated, missing, or refused cancellation outcome.
	 */
	requestCancellationAtomically(command: RequestRunCancellationCommand): Promise<RequestRunCancellationResult>;
}
