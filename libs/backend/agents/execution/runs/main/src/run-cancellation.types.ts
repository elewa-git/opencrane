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

/** Stable categories returned by durable cancellation authority. */
export enum RunCancellationResultStatuses
{
	/** The run is fenced while physical cleanup remains. */
	Cancelling = "cancelling",
	/** The run reached its final cancelled state without pending cleanup. */
	Cancelled = "cancelled",
	/** The exact cancellation was already applied. */
	Idempotent = "idempotent",
	/** No run exists for the supplied identifier. */
	NotFound = "not_found",
	/** Current durable authority rejected the cancellation. */
	Conflict = "conflict",
}

/** Stable reasons durable cancellation authority can reject a request. */
export enum RunCancellationConflictReasons
{
	/** The supplied command is syntactically or semantically invalid. */
	InvalidRequest = "invalid_request",
	/** The run has moved to a newer attempt. */
	AttemptConflict = "attempt_conflict",
	/** The run already finished. */
	TerminalRun = "terminal_run",
	/** Required durable facts did not agree under the cancellation fence. */
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

/** Run-domain persistence port for cancellation and exact workload cleanup. */
export interface RunCancellationRepository
{
	/** Fences one current attempt and schedules cleanup when physical work may exist. */
	requestCancellationAtomically(command: RequestRunCancellationCommand): Promise<RequestRunCancellationResult>;
	/** Claims one eligible cleanup event under a database lease generation. */
	claimNextWorkloadCleanupAtomically(): Promise<ClaimNextRunWorkloadCleanupResult>;
	/** Confirms exact deletion or authoritative absence and finalises Cancelling when applicable. */
	confirmWorkloadCleanupAtomically(eventId: string, command: ConfirmRunWorkloadCleanupCommand): Promise<ConfirmRunWorkloadCleanupResult>;
	/** Persist a first orphan absence and defer its required second observation horizon. */
	deferUnassignedOrphanAbsenceAtomically(eventId: string, claim: RunWorkloadCleanupClaim): Promise<"deferred" | "conflict">;
	/** Fence and terminalise one expired registered runtime attempt without trusting runtime output. */
	repairNextExpiredRunAtomically(): Promise<RepairExpiredRunResult>;
}
