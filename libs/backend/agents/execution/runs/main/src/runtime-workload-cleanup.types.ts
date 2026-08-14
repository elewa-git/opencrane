import type { ConfirmRunWorkloadCleanupResult, RunCancellationRepository, RunWorkloadCleanupProjection } from "./run-cancellation.types";

/** Physical evidence returned by the runtime workload cleanup adapter. */
export type RuntimeWorkloadCleanupStoreResult =
	| { readonly status: "absent" }
	| { readonly status: "deletion_requested"; readonly workloadUid: string };

/**
 * Physical runtime projection port used by the durable cleanup policy.
 *
 * Implementations must read and compare the exact projection before requesting deletion with the
 * Kubernetes object UID as a precondition. The run authority never receives a raw Kubernetes type.
 */
export interface RuntimeWorkloadCleanupStore
{
	/**
	 * Confirms the Job is gone, or asks Kubernetes to delete exactly the Job this record names.
	 *
	 * @param workload - The cleanup record; every field used to address the Job comes from here, not
	 * from the caller.
	 * @returns `absent` means the Job is definitely not there. `deletion_requested` carries the UID
	 * that was deleted, which the caller must pass back when confirming cleanup.
	 * @throws When Kubernetes cannot be reached or refuses the request; the caller leaves the claim
	 * to expire and the cleanup is retried by a later pass.
	 */
	deleteExactProjection(workload: RunWorkloadCleanupProjection): Promise<RuntimeWorkloadCleanupStoreResult>;
}

/** Dependencies of the durable workload cleanup use case. */
export interface RuntimeWorkloadCleanupUseCaseDependencies
{
	/** Durable claim, orphan-observation, and confirmation authority. */
	readonly repository: RunCancellationRepository;
	/** Narrow physical adapter that can remove only one exact projection. */
	readonly store: RuntimeWorkloadCleanupStore;
}

/** Result of one bounded workload cleanup reconciliation. */
export type RuntimeWorkloadCleanupReconcileResult =
	| { readonly outcome: "idle" }
	| { readonly outcome: "deletion_requested"; readonly eventId: string; readonly runId: string; readonly attempt: number; readonly workloadUid: string }
	| { readonly outcome: "orphan_absence_deferred"; readonly eventId: string; readonly runId: string; readonly attempt: number }
	| { readonly outcome: "absence_confirmed"; readonly eventId: string; readonly confirmation: Exclude<ConfirmRunWorkloadCleanupResult, { readonly status: "conflict" }> };

/**
 * The scheduled cleanup pass, as the process that runs it sees it.
 *
 * Call `reconcileNext` on a timer; each call handles at most one cleanup event, so a backlog
 * drains over several ticks. Calling it while a pass is still running returns that same pass
 * instead of starting a second, so overlapping timer ticks are safe. Call `drain` on shutdown to
 * wait for a pass in flight; it deliberately does not surface that pass's error, because the
 * scheduled caller already reports it.
 *
 * @see __CreateRuntimeWorkloadCleanupUseCase
 */
export interface RuntimeWorkloadCleanupUseCase
{
	/** Claim and reconcile at most one cleanup event. */
	reconcileNext(): Promise<RuntimeWorkloadCleanupReconcileResult>;
	/** Wait until the currently active reconciliation, if any, has settled. */
	drain(): Promise<void>;
}
