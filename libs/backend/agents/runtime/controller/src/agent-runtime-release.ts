import { __BuildSuspendedAgentRuntimeJob, __DeriveAgentRuntimeReleaseDeadlineSeconds } from "@opencrane/backend/agents/runtime/k8s-launcher";
import { ___DoWithTrace } from "@opencrane/observability";

import { _ResolveAgentControllerRuntimeProfile } from "./agent-controller-profiles.js";
import { AgentControllerReconcileOutcomes, type AgentControllerOptions, type AgentControllerRuntimeReleaseReconcileResult } from "./agent-controller.types.js";
import { _AgentRuntimeAttemptKeySecretName } from "./agent-runtime-attempt-key.js";

/** Require an immutable Pod UID observed through the Kubernetes API. */
function _RequirePodUid(uid: string | undefined): string
{
	if (!uid || uid.trim().length === 0)
	{
		throw new Error("Kubernetes did not return an immutable UID for the first runtime Pod");
	}
	return uid;
}

/**
 * Reconcile one durable workload release through exact Job and first-Pod evidence.
 *
 * The assigned Job is rebuilt from durable coordinates and released through compare-and-swap.
 * First-Pod registration then closes the bootstrap identity fence before runtime exchange.
 * @param options - Fixed authority, profiles, Kubernetes adapter, and logger.
 * @param signal - Process shutdown propagated to authority calls.
 * @returns Idle, pending Pod creation, or the registration outcome.
 */
export async function __ReconcileNextRuntimeRelease(options: AgentControllerOptions, signal: AbortSignal): Promise<AgentControllerRuntimeReleaseReconcileResult>
{
	return ___DoWithTrace("agent_controller.workload_release.reconcile", {}, async function _reconcileWorkloadRelease(): Promise<AgentControllerRuntimeReleaseReconcileResult>
	{
		// 1. Claim a durable release generation so stale controller replicas cannot register a Pod.
		const claim = await options.authority.__ClaimWorkloadRelease(signal);
		if (!claim) return { outcome: AgentControllerReconcileOutcomes.Idle };

		// 2. Rebuild the exact assigned Job from authority coordinates and the fixed release profile.
		const profile = _ResolveAgentControllerRuntimeProfile(options.profiles, claim.workload.workloadProfile);
		if (!profile || claim.workload.namespace !== profile.namespace || profile.serverNamespace === profile.namespace || profile.serviceAccountName !== claim.workload.serviceAccountName)
		{
			throw new Error("claimed runtime release does not match this silo's bounded workload profile");
		}
		const job = __BuildSuspendedAgentRuntimeJob({
			runId: claim.workload.runId,
			attempt: claim.workload.attempt,
			agentServiceId: claim.workload.agentServiceId,
			agentRevisionId: claim.workload.agentRevisionId,
			siloId: claim.workload.siloId,
			namespace: claim.workload.namespace,
			bootstrapReference: claim.workload.bootstrapReference,
			litellmKeySecretName: _AgentRuntimeAttemptKeySecretName(claim.workload.bootstrapReference),
		}, profile);

		// 3. Reject expired authority, then let the Kubernetes adapter reserve its I/O budget.
		const authorityUpperBoundEpochMilliseconds = Math.max(Date.now(), Date.parse(claim.lease.expiresAt));
		__DeriveAgentRuntimeReleaseDeadlineSeconds(claim.workload.assignmentExpiresAt, authorityUpperBoundEpochMilliseconds, profile.activeDeadlineSeconds);
		await options.kubernetes.__EnsureRuntimeJobReleased(job, claim.workload.workloadUid, claim.workload.assignmentExpiresAt, claim.lease.expiresAt);

		// 4. Wait for one uniquely owned first Pod without choosing among ambiguous candidates.
		const pod = await options.kubernetes.__FindFirstRuntimePod(job, claim.workload.workloadUid, claim.workload.serviceAccountName);
		if (!pod)
		{
			return { outcome: AgentControllerReconcileOutcomes.PendingPod, eventId: claim.lease.eventId, runId: claim.workload.runId, attempt: claim.workload.attempt, workloadUid: claim.workload.workloadUid };
		}
		const podUid = _RequirePodUid(pod.metadata?.uid);

		// 5. Register the exact Pod through OpenCrane authority before runtime may exchange bootstrap.
		const registered = await options.authority.__RegisterFirstPod(claim.lease.eventId, {
			claimedAt: claim.lease.claimedAt,
			deliveryCount: claim.lease.deliveryCount,
			runId: claim.workload.runId,
			attempt: claim.workload.attempt,
			siloId: claim.workload.siloId,
			agentServiceId: claim.workload.agentServiceId,
			agentRevisionId: claim.workload.agentRevisionId,
			namespace: claim.workload.namespace,
			serviceAccountName: claim.workload.serviceAccountName,
			workloadUid: claim.workload.workloadUid,
			workloadProfile: claim.workload.workloadProfile,
			bootstrapReference: claim.workload.bootstrapReference,
			podUid,
		}, signal);

		options.log.info({ eventId: claim.lease.eventId, runId: claim.workload.runId, attempt: claim.workload.attempt, workloadUid: claim.workload.workloadUid, podUid, outcome: registered.outcome }, "runtime workload released and first Pod registered");
		return { outcome: registered.outcome, eventId: claim.lease.eventId, runId: claim.workload.runId, attempt: claim.workload.attempt, workloadUid: claim.workload.workloadUid, podUid };
	});
}
