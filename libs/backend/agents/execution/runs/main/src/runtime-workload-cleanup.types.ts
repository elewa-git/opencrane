import type { ConfirmRunWorkloadCleanupResult, RunCancellationRepository, RunWorkloadCleanupProjection } from "./run-cancellation.types.js";

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
	/** Observe absence or request deletion of exactly the database-issued workload projection. */
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

/** One bounded durable cleanup operation composed by the process entrypoint. */
export interface RuntimeWorkloadCleanupUseCase
{
	/** Claim and reconcile at most one cleanup event. */
	reconcileNext(): Promise<RuntimeWorkloadCleanupReconcileResult>;
	/** Wait until the currently active reconciliation, if any, has settled. */
	drain(): Promise<void>;
}
