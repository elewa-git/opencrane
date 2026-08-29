import { __BuildGovernedSkillWorkloadJob } from "@opencrane/backend/agents/skills/k8s-launcher";
import { __CreateSkillWorkloadBootstrapReference } from "@opencrane/contracts";
import { ___DoWithTrace } from "@opencrane/backend/observability";

import { SkillWorkloadControllerReconcileOutcomes, type SkillWorkloadControllerOptions, type SkillWorkloadControllerReleaseReconcileResult } from "./skill-workload-controller.types";

/** Requires the immutable Pod UID that Kubernetes issued for the first released worker Pod. */
function _RequirePodUid(uid: string | undefined): string
{
	if (!uid || uid.trim().length === 0)
		throw new Error("Kubernetes did not return an immutable UID for the first governed skill worker Pod");
	return uid;
}

/**
 * Unsuspends one assigned skill Job and records the first Pod that Job created.
 *
 * The release fence binds the Kubernetes update and Pod registration to one durable delivery. A
 * pending Pod is not an error: the poll loop waits before it asks Kubernetes for the same evidence.
 *
 * Called by: __RunSkillWorkloadController.
 * @param options - Server authority, Job store, class profiles, and logger for one controller silo.
 * @param signal - Process shutdown signal passed to the server authority.
 * @returns Idle, pending-Pod, registered, or idempotent evidence for the completed pass.
 */
export async function __ReconcileNextSkillWorkloadRelease(options: SkillWorkloadControllerOptions, signal: AbortSignal): Promise<SkillWorkloadControllerReleaseReconcileResult>
{
	return ___DoWithTrace("agent_controller.skill_workload.release.reconcile", {}, async function _ReconcileSkillWorkloadRelease(): Promise<SkillWorkloadControllerReleaseReconcileResult>
	{
		// 1. Take a release claim from the database, because Kubernetes never decides what to release.
		const claim = await options.authority.__ClaimRelease(signal);
		if (claim === null)
			return { outcome: SkillWorkloadControllerReconcileOutcomes.Idle };

		// 2. Rebuild the expected Job from its class profile and retained bootstrap reference.
		const profile = options.profiles[claim.kind];
		if (!profile || profile.serverNamespace === profile.namespace)
			throw new Error("governed skill workload release does not match a bounded isolated profile");
		const capabilityReference = await __CreateSkillWorkloadBootstrapReference(claim.workloadId);
		const job = __BuildGovernedSkillWorkloadJob({ jobId: claim.workloadId, siloId: claim.siloId, namespace: profile.namespace, capabilityReference }, profile);

		// 3. Release the saved Job UID, then record that effect through the same database release fence.
		await options.kubernetes.releaseJob(job, claim.workloadUid, claim.expiresAt);
		const released = await options.authority.__CommitRelease(claim.workloadId, { releaseClaimedAt: claim.releaseClaimedAt, releaseDeliveryCount: claim.releaseDeliveryCount, workloadUid: claim.workloadUid }, signal);
		if (released === "conflict")
			throw new Error("governed skill workload release lost its database claim fence");

		// 4. Register the first Job-owned Pod before that worker can trade its bootstrap reference.
		const pod = await options.kubernetes.findFirstPod(job, claim.workloadUid, profile.serviceAccountName);
		if (pod === null)
			return { outcome: SkillWorkloadControllerReconcileOutcomes.PendingPod, workloadId: claim.workloadId, workloadUid: claim.workloadUid };
		const podUid = _RequirePodUid(pod.metadata?.uid);
		const registered = await options.authority.__RegisterFirstPod(claim.workloadId, { releaseClaimedAt: claim.releaseClaimedAt, releaseDeliveryCount: claim.releaseDeliveryCount, workloadUid: claim.workloadUid, podUid }, signal);
		if (registered === "conflict")
			throw new Error("governed skill workload Pod registration lost its durable release fence");
		options.log.info({ workloadId: claim.workloadId, workloadUid: claim.workloadUid, podUid, outcome: registered }, "governed skill workload released and first Pod registered");
		return { outcome: registered === "registered" ? SkillWorkloadControllerReconcileOutcomes.Registered : SkillWorkloadControllerReconcileOutcomes.Idempotent, workloadId: claim.workloadId, workloadUid: claim.workloadUid, podUid };
	});
}
