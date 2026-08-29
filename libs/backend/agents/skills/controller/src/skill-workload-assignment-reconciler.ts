import { __BuildGovernedSkillWorkloadJob } from "@opencrane/backend/agents/skills/k8s-launcher";
import { __CreateSkillWorkloadBootstrapReference } from "@opencrane/contracts";
import { ___DoWithTrace } from "@opencrane/backend/observability";

import { SkillWorkloadControllerReconcileOutcomes, type SkillWorkloadControllerOptions, type SkillWorkloadControllerReconcileResult } from "./skill-workload-controller.types";

/** Requires the immutable Job UID that Kubernetes issued for a suspended skill workload. */
function _RequireWorkloadUid(uid: string | undefined): string
{
	if (!uid || uid.trim().length === 0)
		throw new Error("Kubernetes did not return an immutable UID for the suspended governed skill Job");
	return uid;
}

/**
 * Turns at most one claimed skill workload into a suspended Kubernetes Job and commits its UID.
 *
 * The committed UID and opaque bootstrap reference bind a later release to the database claim; a
 * conflict throws instead of allowing a stale controller replica to assign executable work.
 *
 * Called by: __RunSkillWorkloadController.
 * @param options - Server authority, Job store, class profiles, and logger for one controller silo.
 * @param signal - Process shutdown signal passed to the server authority.
 * @returns Idle when no claim exists; otherwise the assigned or idempotent Job UID.
 */
export async function __ReconcileNextSkillWorkload(options: SkillWorkloadControllerOptions, signal: AbortSignal): Promise<SkillWorkloadControllerReconcileResult>
{
	return ___DoWithTrace("agent_controller.skill_workload.reconcile", {}, async function _ReconcileSkillWorkload(): Promise<SkillWorkloadControllerReconcileResult>
	{
		// 1. Read what the OpenCrane server says should run, because Kubernetes never chooses work.
		const claim = await options.authority.__Claim(signal);
		if (claim === null)
			return { outcome: SkillWorkloadControllerReconcileOutcomes.Idle };

		// 2. Rebuild the suspended Job from the selected class profile and opaque bootstrap reference.
		const profile = options.profiles[claim.kind];
		const capabilityReference = await __CreateSkillWorkloadBootstrapReference(claim.workloadId);
		const job = __BuildGovernedSkillWorkloadJob({ jobId: claim.workloadId, siloId: claim.siloId, namespace: profile.namespace, capabilityReference }, profile);

		// 3. Commit the Kubernetes-issued UID against the same claim before another controller can release it.
		const persistedJob = await options.kubernetes.ensureSuspendedJob(job);
		const workloadUid = _RequireWorkloadUid(persistedJob.metadata?.uid);
		const outcome = await options.authority.__CommitAssignment(claim.workloadId, { claimedAt: claim.claimedAt, deliveryCount: claim.deliveryCount, workloadUid, bootstrapReference: capabilityReference, namespace: profile.namespace }, signal);
		if (outcome === "conflict")
			throw new Error("governed skill workload assignment lost its database claim fence");
		options.log.info({ workloadId: claim.workloadId, workloadUid, outcome }, "governed skill workload assigned to suspended Job");
		return { outcome: outcome === "assigned" ? SkillWorkloadControllerReconcileOutcomes.Assigned : SkillWorkloadControllerReconcileOutcomes.Idempotent, workloadId: claim.workloadId, workloadUid };
	});
}
