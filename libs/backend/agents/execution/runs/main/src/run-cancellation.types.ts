/** Fixed lease and orphan-observation policy for cancellation cleanup authority. */
export interface RunCancellationRepositoryConfig
{
	/** Dedicated namespace in which personal runtime Jobs may exist. */
	readonly personalRuntimeNamespace: string;
	/** Dedicated namespace in which managed runtime Jobs may exist. */
	readonly managedRuntimeNamespace: string;
	/** Time after which an abandoned cleanup claim may be reclaimed. */
	readonly claimLeaseMilliseconds: number;
	/** Additional time after a dispatch lease in which an in-flight Kubernetes create may finish. */
	readonly orphanObservationMarginMilliseconds: number;
}

/** User-authorised request to fence one exact current run attempt. */
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
 * What happened when someone asked to cancel a run.
 *
 * Cancelling a run is two jobs, and this status says which of them is left. First the database
 * marks the run so no further work is accepted, which always succeeds or fails outright. Second,
 * if a Kubernetes Job may already exist for the run, that Job has to be deleted — and that part
 * happens later, in a separate worker pass. So `Cancelling` means "stopped, cleanup still owed"
 * and `Cancelled` means "stopped, nothing left to delete". A caller that treats them as the same
 * thing will report a run as fully torn down while its pod is still running.
 *
 * The values are the wire form the HTTP layer returns to the caller who asked for the cancellation.
 * @see RequestRunCancellationResult for the payload carried with each status.
 * @see RunCancellationConflictReasons for why a `Conflict` was refused.
 */
export enum RunCancellationResultStatuses
{
	/** The run is stopped, but a Kubernetes Job may still exist and cleanup is owed. */
	Cancelling = "cancelling",
	/** The run is stopped and there is nothing left to delete. */
	Cancelled = "cancelled",
	/** This same cancellation already happened, so nothing changed. Safe to retry into. */
	Idempotent = "idempotent",
	/** No run exists with that id. */
	NotFound = "not_found",
	/** The run exists but cannot be cancelled right now. */
	Conflict = "conflict",
}

/**
 * Why a cancellation was refused.
 *
 * Each reason is a different problem for the caller. `AttemptConflict` and `TerminalRun` mean the
 * caller was working from a stale view of the run and should re-read it; `InvalidRequest` means the
 * command itself was malformed and retrying it unchanged will fail the same way; `AuthorityConflict`
 * means the run's own database rows disagreed, which is a server-side problem, not the caller's.
 * @see RunCancellationResultStatuses.Conflict which carries one of these.
 */
export enum RunCancellationConflictReasons
{
	/** The command was malformed: a missing id, or an attempt number that is not a positive integer. */
	InvalidRequest = "invalid_request",
	/** The run has since started a newer attempt, so the attempt the caller named is no longer current. */
	AttemptConflict = "attempt_conflict",
	/** The run already finished, so there is nothing to cancel. */
	TerminalRun = "terminal_run",
	/** The run's own rows disagreed while cancelling, so nothing was changed. */
	AuthorityConflict = "authority_conflict",
}

/** Durable outcome of requesting cancellation. */
export type RequestRunCancellationResult =
	| { readonly status: "cancelling"; readonly runId: string; readonly attempt: number; readonly cleanupRequired: true }
	| { readonly status: "cancelled"; readonly runId: string; readonly attempt: number; readonly cleanupRequired: false }
	| { readonly status: "idempotent"; readonly runId: string; readonly attempt: number; readonly state: "cancelling" | "cancelled" }
	| { readonly status: "not_found" }
	| { readonly status: "conflict"; readonly reason: "invalid_request" | "attempt_conflict" | "terminal_run" | "authority_conflict" };

/** Exact cleanup mode persisted by the run authority. */
export type RunWorkloadCleanupMode = "assigned" | "unassigned_orphan";

/** Database-issued cleanup projection; it contains no caller-selected authority. */
export interface RunWorkloadCleanupProjection
{
	/** Logical run whose product authority has already been fenced. */
	readonly runId: string;
	/** Exact attempt that owned, or may have created, the Job. */
	readonly attempt: number;
	/** Silo boundary expected on the Job annotations. */
	readonly siloId: string;
	/** Agent service expected on the Job annotations. */
	readonly agentServiceId: string;
	/** Immutable agent revision expected on the Job annotations. */
	readonly agentRevisionId: string;
	/** Dedicated runtime namespace containing the deterministic Job. */
	readonly namespace: string;
	/**
	 * Immutable profile name retained with cleanup authority for durable audit.
	 *
	 * The cleanup adapter rebinds only fields actually projected into the Job; it does not select or
	 * reconstruct deployment policy from this name.
	 */
	readonly workloadProfile: string;
	/** Opaque bootstrap reference expected on the Job Pod template. */
	readonly bootstrapReference: string;
	/** Exact Kubernetes UID when an assignment was committed; absent only for an in-flight orphan. */
	readonly workloadUid: string | null;
	/** Whether cleanup has an exact assignment UID or must first verify a suspended orphan. */
	readonly mode: RunWorkloadCleanupMode;
	/** Why cleanup exists; cancellation finalises the run while failure only removes residue. */
	readonly reason: "cancellation" | "dispatch_failure" | "runtime_lease_expired";
	/** First authoritative orphan absence, retained until a second post-horizon observation confirms it. */
	readonly orphanAbsenceObservedAt?: string | null;
}

/** Database claim generation fencing one cleanup worker delivery. */
export interface RunWorkloadCleanupClaimLease
{
	/** Cleanup outbox event identifier. */
	readonly eventId: string;
	/** Database-owned claim instant. */
	readonly claimedAt: string;
	/** Monotonic delivery generation. */
	readonly deliveryCount: number;
	/** Instant after which another worker may reclaim this generation. */
	readonly expiresAt: string;
}

/** One exact cleanup claim returned to the future cleaner transport. */
export interface RunWorkloadCleanupClaim
{
	/** Fenced delivery lease. */
	readonly lease: RunWorkloadCleanupClaimLease;
	/** Server-derived Job identity and cleanup mode. */
	readonly workload: RunWorkloadCleanupProjection;
}

/** Outcome of claiming the next eligible cleanup command. */
export type ClaimNextRunWorkloadCleanupResult =
	| { readonly status: "claimed"; readonly claim: RunWorkloadCleanupClaim }
	| { readonly status: "none" };

/** Outcome of one server-owned expired-runtime repair pass. */
export type RepairExpiredRunResult = { readonly status: "repaired"; readonly runId: string; readonly attempt: number } | { readonly status: "none" };

/** Exact cleaner evidence submitted after UID-preconditioned deletion or authoritative absence. */
export interface ConfirmRunWorkloadCleanupCommand
{
	/** Claim generation held by this cleaner process. */
	readonly claimedAt: string;
	/** Monotonic delivery generation held by this cleaner process. */
	readonly deliveryCount: number;
	/** Logical run rebound from the cleanup claim. */
	readonly runId: string;
	/** Exact attempt rebound from the cleanup claim. */
	readonly attempt: number;
	/** UID deleted or observed absent; required for assigned cleanup. */
	readonly workloadUid: string | null;
	/** Physical result independently established by the Kubernetes adapter. */
	readonly outcome: "deleted" | "absent";
}

/** Durable outcome of confirming cleanup. */
export type ConfirmRunWorkloadCleanupResult =
	| { readonly status: "confirmed"; readonly runId: string; readonly attempt: number; readonly runFinalized: boolean }
	| { readonly status: "idempotent"; readonly runId: string; readonly attempt: number; readonly runFinalized: boolean }
	| { readonly status: "conflict"; readonly reason: "invalid_confirmation" | "claim_not_found" | "stale_claim" | "claim_terminal" | "authority_conflict" };

/**
 * Every database write involved in stopping a run and deleting the Job it left behind.
 *
 * The methods are the steps of one flow, in order. A user cancels a run, which stops it and may
 * queue cleanup ({@link requestCancellationAtomically}). A background worker then picks up that
 * cleanup one item at a time ({@link claimNextWorkloadCleanupAtomically}), deletes the Job through
 * Kubernetes, and reports back what it found ({@link confirmWorkloadCleanupAtomically}). The two
 * odd ones out are {@link deferUnassignedOrphanAbsenceAtomically}, which handles a Job that might
 * still be mid-creation, and {@link repairNextExpiredRunAtomically}, which cleans up after a runtime
 * that died without saying so.
 *
 * Every method name ends in `Atomically` for a reason: each one does all of its work in a single
 * database transaction. Two workers running the same method at once must not both win, so callers
 * may run them concurrently and act on the returned status rather than locking beforehand.
 *
 * Called by: `_RequestSelfRunCancellation` (a user cancelling their own run),
 * `__CreateRuntimeWorkloadCleanupUseCase` (the cleanup worker), and `_StartBackgroundWorkers` in
 * apps/opencrane (the expired-runtime repair loop).
 *
 * @see PrismaRunCancellationRepository — the only implementation.
 * @see _CreateRunCancellationAuthority — builds it for the running process.
 */
export interface RunCancellationRepository
{
	/**
	 * Stops the run the caller named, and queues Job cleanup if a Job may exist.
	 *
	 * @param command - Run to stop, the attempt the caller believes is current, and who asked.
	 * @returns `cancelling` when cleanup is still owed, `cancelled` when nothing is left to delete,
	 * `idempotent` when this already happened, `not_found`, or `conflict` with a reason.
	 * @see RunCancellationResultStatuses for what the caller must do with each status.
	 */
	requestCancellationAtomically(command: RequestRunCancellationCommand): Promise<RequestRunCancellationResult>;
	/**
	 * Takes ownership of the next Job that needs deleting, for a limited time.
	 *
	 * The claim is leased rather than permanent, so a worker that crashes mid-delete does not strand
	 * the item: after `claimLeaseMilliseconds` another worker may claim the same one.
	 *
	 * @returns `claimed` with the Job's identity and the lease, or `none` when no cleanup is due.
	 */
	claimNextWorkloadCleanupAtomically(): Promise<ClaimNextRunWorkloadCleanupResult>;
	/**
	 * Records that the Job was deleted, or was confirmed already gone, and finishes the run if that
	 * was the last thing it was waiting on.
	 *
	 * @param eventId - Cleanup item being confirmed, from the claim.
	 * @param command - The lease this worker holds, plus what Kubernetes actually reported.
	 * @returns `confirmed`, `idempotent` if another worker got there first, or `conflict` when the
	 * lease is no longer valid — in which case this worker must stop and not retry.
	 */
	confirmWorkloadCleanupAtomically(eventId: string, command: ConfirmRunWorkloadCleanupCommand): Promise<ConfirmRunWorkloadCleanupResult>;
	/**
	 * Records a first sighting of a missing Job without acting on it yet, and schedules a second look.
	 *
	 * A Job that is absent right now may simply not have been created yet, because the create call can
	 * still be in flight. Deleting the run's record on one sighting would race that create and leave a
	 * pod nobody owns, so absence must be seen twice, `orphanObservationMarginMilliseconds` apart.
	 *
	 * @param eventId - Cleanup item being deferred.
	 * @param claim - The lease this worker holds.
	 * @returns `deferred` once the second look is scheduled, or `conflict` if the lease went stale.
	 */
	deferUnassignedOrphanAbsenceAtomically(eventId: string, claim: RunWorkloadCleanupClaim): Promise<"deferred" | "conflict">;
	/**
	 * Finishes one run whose runtime stopped reporting, using only what the database already knows.
	 *
	 * A runtime holds a lease while it works. If that lease expires the runtime is gone, but its run
	 * is still sitting in a running state. This ends that run. Nothing the dead runtime produced is
	 * trusted here, because a runtime that missed its lease cannot be asked what it managed to do.
	 *
	 * @returns `repaired` with the run it ended, or `none` when no lease has expired.
	 */
	repairNextExpiredRunAtomically(): Promise<RepairExpiredRunResult>;
}
