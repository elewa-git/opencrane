import { __BuildSuspendedMcpExecutorJob } from "@opencrane/backend/agents/runtime/mcp-executor/k8s-launcher";
import { ___DoWithTrace } from "@opencrane/backend/observability";

import { McpExecutorControllerOutcomes, type McpExecutorControllerOptions, type McpExecutorControllerReconcileResult } from "./mcp-executor-controller.types";

/** Requires the immutable Kubernetes Job UID before it can be committed to the database authority. */
function _RequiredJobUid(value: string | undefined): string
{
	if (!value || value.trim().length === 0)
		throw new Error("Kubernetes did not return an immutable UID for the MCP executor Job");
	return value;
}

/**
 * Creates or adopts one suspended MCP Job, then commits its Kubernetes UID through the claim fence.
 *
 * Kubernetes receives the server-selected image and cannot release the Job until the assignment
 * write succeeds. A conflict throws so the poll loop logs the stale delivery instead of adopting it.
 *
 * Called by: __RunMcpExecutorController.
 * @param options - Server authority, Job store, profile, and logger for one controller silo.
 * @param signal - Process shutdown signal passed to the server authority.
 * @returns Idle when no claim exists; otherwise the assigned or idempotent Job UID.
 */
export async function __ReconcileNextMcpExecutorWorkload(options: McpExecutorControllerOptions, signal: AbortSignal): Promise<McpExecutorControllerReconcileResult>
{
	return ___DoWithTrace("agent_controller.mcp_executor.reconcile", {}, async function _Reconcile(): Promise<McpExecutorControllerReconcileResult>
	{
		// 1. Take one database claim so Kubernetes never chooses an image or unit of work.
		const claimed = await options.authority.__Claim(signal);
		if (claimed === null)
			return { outcome: McpExecutorControllerOutcomes.Idle };

		// 2. Rebuild the suspended Job from the imported digest and deployment-owned profile.
		const job = __BuildSuspendedMcpExecutorJob({ claim: claimed.claim, registryReference: claimed.registryReference, namespace: options.profile.namespace }, options.profile, new Date(claimed.claim.claimedAt));
		const persisted = await options.kubernetes.ensureSuspendedJob(job);
		const workloadUid = _RequiredJobUid(persisted.metadata?.uid);

		// 3. Fence the assignment against the same claim delivery before the Job can be released.
		const binding = { claimId: claimed.claim.claimId, claimedAt: claimed.claim.claimedAt, deliveryCount: claimed.claim.deliveryCount, profileName: claimed.claim.profileName, workloadUid };
		const outcome = await options.authority.__CommitAssignment(binding, signal);
		if (outcome === "conflict")
			throw new Error("MCP executor assignment lost its database claim fence");
		options.log.info({ claimId: claimed.claim.claimId, workloadUid, outcome }, "MCP executor assigned to suspended Job");
		return { outcome: outcome === "assigned" ? McpExecutorControllerOutcomes.Assigned : McpExecutorControllerOutcomes.Idempotent, claimId: claimed.claim.claimId, workloadUid };
	});
}
