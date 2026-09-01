import { __BuildSuspendedMcpExecutorJob } from "@opencrane/backend/agents/runtime/mcp-executor/k8s-launcher";
import { ___DoWithTrace } from "@opencrane/backend/observability";

import { McpExecutorControllerOutcomes, type McpExecutorControllerOptions, type McpExecutorControllerReleaseResult } from "./mcp-executor-controller.types";

/** Requires the immutable Kubernetes Pod UID before companion bootstrap can be registered. */
function _RequiredPodUid(value: string | undefined): string
{
	if (!value || value.trim().length === 0)
		throw new Error("Kubernetes did not return an immutable UID for the MCP executor Pod");
	return value;
}

/**
 * Releases an assigned MCP Job and records its first Pod through the same release fence.
 *
 * The Job UID is durable before unsuspension. Registration then waits for the first Pod owned by
 * that Job so the companion cannot use an unrecorded workload identity.
 *
 * Called by: {@link __RunMcpExecutorController}.
 * @param options - Server authority, Job store, profile, and logger for one controller silo.
 * @param signal - Process shutdown signal passed to server and Kubernetes operations.
 * @returns Idle, pending-Pod, registered, or idempotent evidence for the completed pass.
 * @throws Error When release, Pod identity, or the saved database fence cannot be proved.
 */
export async function __ReconcileNextMcpExecutorRelease(options: McpExecutorControllerOptions, signal: AbortSignal): Promise<McpExecutorControllerReleaseResult>
{
	return ___DoWithTrace("agent_controller.mcp_executor.release.reconcile", {}, async function _ReconcileRelease(): Promise<McpExecutorControllerReleaseResult>
	{
		// 1. Take a database-fenced release claim and rebuild the expected assigned Job.
		const claimed = await options.authority.__ClaimRelease(signal);
		if (claimed === null)
			return { outcome: McpExecutorControllerOutcomes.Idle };
		const job = __BuildSuspendedMcpExecutorJob({ claim: claimed.claim, registryReference: claimed.registryReference, namespace: options.profile.namespace }, options.profile, new Date(claimed.claim.claimedAt));

		// 2. Release the saved Job UID, then record that external update against the release claim.
		await options.kubernetes.releaseJob(job, claimed.workloadUid, { expiresAt: claimed.releaseExpiresAt });
		const command = { releaseClaimedAt: claimed.releaseClaimedAt, releaseDeliveryCount: claimed.releaseDeliveryCount, workloadUid: claimed.workloadUid };
		const releaseOutcome = await options.authority.__CommitRelease(claimed.claim.claimId, command, signal);
		if (releaseOutcome === "conflict")
			throw new Error("MCP executor release lost its database claim fence");

		// 3. Accept the first Pod owned by that Job and persist its Kubernetes UID.
		const pod = await options.kubernetes.findFirstPod(job, claimed.workloadUid, options.profile.serviceAccountName);
		if (pod === null)
			return { outcome: McpExecutorControllerOutcomes.PendingPod, claimId: claimed.claim.claimId, workloadUid: claimed.workloadUid };
		const podUid = _RequiredPodUid(pod.metadata?.uid);
		const registration = await options.authority.__RegisterFirstPod(claimed.claim.claimId, { ...command, podUid }, signal);
		if (registration === "conflict")
			throw new Error("MCP executor Pod registration lost its database release fence");
		options.log.info({ claimId: claimed.claim.claimId, workloadUid: claimed.workloadUid, podUid, outcome: registration }, "MCP executor released and first Pod registered");
		return { outcome: registration === "registered" ? McpExecutorControllerOutcomes.Registered : McpExecutorControllerOutcomes.Idempotent, claimId: claimed.claim.claimId, workloadUid: claimed.workloadUid, podUid };
	});
}
