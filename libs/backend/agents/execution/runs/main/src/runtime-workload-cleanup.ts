import type { RunWorkloadCleanupClaim } from "./run-cancellation.types";
import type { RuntimeWorkloadCleanupReconcileResult, RuntimeWorkloadCleanupUseCase, RuntimeWorkloadCleanupUseCaseDependencies } from "./runtime-workload-cleanup.types";

/** Turns "the Job is gone" into the confirmation command, carrying the claim generation that fences it. */
function _AbsenceConfirmation(claim: RunWorkloadCleanupClaim)
{
	return {
		claimedAt: claim.lease.claimedAt,
		deliveryCount: claim.lease.deliveryCount,
		runId: claim.workload.runId,
		attempt: claim.workload.attempt,
		workloadUid: claim.workload.workloadUid,
		outcome: "absent" as const,
	};
}

/** Reconcile one database-issued cleanup claim through the narrow physical store port. */
async function _ReconcileNext(dependencies: RuntimeWorkloadCleanupUseCaseDependencies): Promise<RuntimeWorkloadCleanupReconcileResult>
{
	// 1. Claim durable authority first so no Kubernetes observation can invent cleanup permission.
	const claimed = await dependencies.repository.claimNextWorkloadCleanupAtomically();
	if (claimed.status === "none") return { outcome: "idle" };
	const claim = claimed.claim;

	// 2. Ask the physical adapter to observe or delete only the exact database-issued projection.
	const physical = await dependencies.store.deleteExactProjection(claim.workload);
	if (physical.status === "deletion_requested")
	{
		return { outcome: "deletion_requested", eventId: claim.lease.eventId, runId: claim.workload.runId, attempt: claim.workload.attempt, workloadUid: physical.workloadUid };
	}

	// 3. Require two post-horizon absence observations for a Job that may have been in-flight.
	if (claim.workload.mode === "unassigned_orphan" && claim.workload.orphanAbsenceObservedAt === null)
	{
		const deferred = await dependencies.repository.deferUnassignedOrphanAbsenceAtomically(claim.lease.eventId, claim);
		if (deferred !== "deferred") throw new Error("runtime orphan absence deferral conflicted");
		return { outcome: "orphan_absence_deferred", eventId: claim.lease.eventId, runId: claim.workload.runId, attempt: claim.workload.attempt };
	}

	// 4. Confirm only authoritative absence under the exact claim generation held by this worker.
	const confirmation = await dependencies.repository.confirmWorkloadCleanupAtomically(claim.lease.eventId, _AbsenceConfirmation(claim));
	if (confirmation.status === "conflict") throw new Error(`runtime cleanup absence confirmation conflicted: ${confirmation.reason}`);
	return { outcome: "absence_confirmed", eventId: claim.lease.eventId, confirmation };
}

/**
 * Builds the cleanup pass that deletes the Kubernetes Jobs of cancelled and failed runs.
 *
 * The returned object runs at most one pass at a time: calling `reconcileNext` while a pass is
 * still running returns that same pass rather than starting a second one, so two schedulers
 * cannot double-claim. `drain` waits for a pass in flight and is meant for shutdown; it never
 * reports the pass's error, because the scheduled caller already owns error reporting.
 *
 * Called by: `apps/opencrane/src/app/background-workers.ts`.
 *
 * @param dependencies - The durable cleanup authority and the Kubernetes adapter.
 * @returns The use case to schedule; one call reconciles at most one cleanup event.
 */
export function __CreateRuntimeWorkloadCleanupUseCase(dependencies: RuntimeWorkloadCleanupUseCaseDependencies): RuntimeWorkloadCleanupUseCase
{
	let active: Promise<RuntimeWorkloadCleanupReconcileResult> | null = null;
	return {
		reconcileNext(): Promise<RuntimeWorkloadCleanupReconcileResult>
		{
			if (active !== null) return active;
			active = _ReconcileNext(dependencies);
			active.finally(function _releaseActivePass() { active = null; }).catch(function _ignoreReleaseChain() { /* The caller observes the original promise. */ });
			return active;
		},
		async drain(): Promise<void>
		{
			if (active === null) return;
			try
			{
				await active;
			}
			catch
			{
				// The scheduled caller owns error reporting; shutdown only waits for settlement.
			}
		},
	};
}
