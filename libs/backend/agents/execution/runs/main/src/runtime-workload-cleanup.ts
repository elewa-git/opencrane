import type { RunWorkloadCleanupClaim } from "./run-cancellation.types.js";
import type { RuntimeWorkloadCleanupReconcileResult, RuntimeWorkloadCleanupUseCase, RuntimeWorkloadCleanupUseCaseDependencies } from "./runtime-workload-cleanup.types.js";

/** Convert a physical absence into the exact database-fenced confirmation command. */
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

/** Create the durable cleanup use case without binding it to Kubernetes or an app lifecycle. */
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
