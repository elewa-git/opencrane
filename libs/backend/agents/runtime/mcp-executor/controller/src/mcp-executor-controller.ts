import { __BuildSuspendedMcpExecutorJob, type McpExecutorJobProfile } from "@opencrane/backend/agents/runtime/mcp-executor/k8s-launcher";
import { RuntimeWorkloadClaimClasses } from "@opencrane/backend/agents/runtime/workloads/contract";
import { ___DoWithTrace } from "@opencrane/backend/observability";

import { McpExecutorControllerOutcomes, type McpExecutorControllerCleanupResult, type McpExecutorControllerOptions, type McpExecutorControllerReconcileResult, type McpExecutorControllerReleaseResult } from "./mcp-executor-controller.types";

/** Returns one Kubernetes UID and refuses a missing value. */
function _RequiredUid(value: string | undefined, kind: "Job" | "Pod"): string
{
	if (!value || value.trim().length === 0)
		throw new Error(`Kubernetes did not return an immutable UID for the MCP executor ${kind}`);
	return value;
}

/** Checks the complete deployment profile by asking the pure Job builder to consume it. */
export function __ValidateMcpExecutorControllerProfile(value: unknown): McpExecutorJobProfile
{
	if (typeof value !== "object" || value === null || Array.isArray(value))
		throw new Error("MCP executor controller profile must be one object");
	const expectedKeys = ["companionImage", "imagePullPolicy", "serverNamespace", "namespace", "serviceAccountName", "opencraneInternalUrl", "projectedTokenTtlSeconds", "scratchSize", "activeDeadlineSeconds", "serverResources", "companionResources"];
	if (Object.keys(value).length !== expectedKeys.length || !expectedKeys.every(function _HasKey(key): boolean { return Object.hasOwn(value, key); }))
		throw new Error("MCP executor controller profile must contain only its deployment-owned fields");
	const profile = structuredClone(value) as McpExecutorJobProfile;
	const now = new Date("2026-01-01T00:00:00.000Z");
	__BuildSuspendedMcpExecutorJob({ claim: { claimId: "profile-validation", siloId: "profile-validation", workloadClass: RuntimeWorkloadClaimClasses.McpExecutor, profileName: "mcp-isolated", idempotencyKey: "profile-validation", claimedAt: now.toISOString(), deliveryCount: 1, expiresAt: new Date(now.getTime() + 60_000).toISOString(), executionReference: "profile-validation" }, registryReference: `registry.invalid/opencrane/mcp@sha256:${"a".repeat(64)}`, namespace: profile.namespace }, profile, now);
	return profile;
}

/** Creates or adopts one suspended MCP Job and records its Kubernetes UID. */
export async function __ReconcileNextMcpExecutorWorkload(options: McpExecutorControllerOptions, signal: AbortSignal): Promise<McpExecutorControllerReconcileResult>
{
	return ___DoWithTrace("agent_controller.mcp_executor.reconcile", {}, async function _Reconcile(): Promise<McpExecutorControllerReconcileResult>
	{
		// 1. Take one database claim so Kubernetes never chooses an image or unit of work.
		const claimed = await options.authority.__Claim(signal);
		if (claimed === null)
			return { outcome: McpExecutorControllerOutcomes.Idle };

		// 2. Rebuild the suspended Job from the imported digest and deployment-owned profile.
		// Rebuild from the assignment instant because the later release lease, not the expired assignment
		// lease, now authorises the saved manifest to run.
		const job = __BuildSuspendedMcpExecutorJob({ claim: claimed.claim, registryReference: claimed.registryReference, namespace: options.profile.namespace }, options.profile, new Date(claimed.claim.claimedAt));
		const persisted = await options.kubernetes.ensureSuspendedJob(job);
		const workloadUid = _RequiredUid(persisted.metadata?.uid, "Job");

		// 3. Fence the assignment against the same claim delivery before the Job can be released.
		const binding = { claimId: claimed.claim.claimId, claimedAt: claimed.claim.claimedAt, deliveryCount: claimed.claim.deliveryCount, profileName: claimed.claim.profileName, workloadUid };
		const outcome = await options.authority.__CommitAssignment(binding, signal);
		if (outcome === "conflict")
			throw new Error("MCP executor assignment lost its database claim fence");
		options.log.info({ claimId: claimed.claim.claimId, workloadUid, outcome }, "MCP executor assigned to suspended Job");
		return { outcome: outcome === "assigned" ? McpExecutorControllerOutcomes.Assigned : McpExecutorControllerOutcomes.Idempotent, claimId: claimed.claim.claimId, workloadUid };
	});
}

/** Releases one assigned MCP Job and records its first Kubernetes Pod. */
export async function __ReconcileNextMcpExecutorRelease(options: McpExecutorControllerOptions, signal: AbortSignal): Promise<McpExecutorControllerReleaseResult>
{
	return ___DoWithTrace("agent_controller.mcp_executor.release.reconcile", {}, async function _ReconcileRelease(): Promise<McpExecutorControllerReleaseResult>
	{
		// 1. Take a database-fenced release claim and rebuild the same expected Job.
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

		// 3. Accept only the first Pod owned by that Job and persist its Kubernetes UID.
		const pod = await options.kubernetes.findFirstPod(job, claimed.workloadUid, options.profile.serviceAccountName);
		if (pod === null)
			return { outcome: McpExecutorControllerOutcomes.PendingPod, claimId: claimed.claim.claimId, workloadUid: claimed.workloadUid };
		const podUid = _RequiredUid(pod.metadata?.uid, "Pod");
		const registration = await options.authority.__RegisterFirstPod(claimed.claim.claimId, { ...command, podUid }, signal);
		if (registration === "conflict")
			throw new Error("MCP executor Pod registration lost its database release fence");
		options.log.info({ claimId: claimed.claim.claimId, workloadUid: claimed.workloadUid, podUid, outcome: registration }, "MCP executor released and first Pod registered");
		return { outcome: registration === "registered" ? McpExecutorControllerOutcomes.Registered : McpExecutorControllerOutcomes.Idempotent, claimId: claimed.claim.claimId, workloadUid: claimed.workloadUid, podUid };
	});
}

/**
 * Deletes the Job named by one terminal cleanup claim, then records that deletion under its fence.
 *
 * Called by: {@link __RunMcpExecutorController}. A missing claim returns `Idle`; a new or repeated
 * commit returns `Cleaned` or `Idempotent`. Kubernetes failures and `conflict` outcomes throw so the
 * database claim remains available for a later pass.
 *
 * @param options - Server authority, Kubernetes store, deployment profile, and logger for this pass.
 * @param signal - Stops the server request and Kubernetes work during process shutdown.
 * @returns The cleanup outcome and, when work existed, the claim and Job UID.
 * @throws When Kubernetes deletion fails or the server rejects the saved cleanup fence.
 */
export async function __ReconcileNextMcpExecutorCleanup(options: McpExecutorControllerOptions, signal: AbortSignal): Promise<McpExecutorControllerCleanupResult>
{
	return ___DoWithTrace("agent_controller.mcp_executor.cleanup.reconcile", {}, async function _ReconcileCleanup(): Promise<McpExecutorControllerCleanupResult>
	{
		// 1. Take a database-fenced cleanup claim and rebuild the exact assigned Job.
		const claimed = await options.authority.__ClaimCleanup(signal);
		if (claimed === null)
			return { outcome: McpExecutorControllerOutcomes.Idle };
		const job = __BuildSuspendedMcpExecutorJob({ claim: claimed.claim, registryReference: claimed.registryReference, namespace: options.profile.namespace }, options.profile, new Date(claimed.claim.claimedAt));

		// 2. Delete only the saved UID, then commit cleanup under the same delivery fence.
		await options.kubernetes.deleteJob(job, claimed.workloadUid);
		const command = { cleanupClaimedAt: claimed.cleanupClaimedAt, cleanupDeliveryCount: claimed.cleanupDeliveryCount, workloadUid: claimed.workloadUid };
		const outcome = await options.authority.__CommitCleanup(claimed.claim.claimId, command, signal);
		if (outcome === "conflict")
			throw new Error("MCP executor cleanup lost its database claim fence");
		options.log.info({ claimId: claimed.claim.claimId, workloadUid: claimed.workloadUid, outcome }, "MCP executor terminal Job deleted");
		return { outcome: outcome === "cleaned" ? McpExecutorControllerOutcomes.Cleaned : McpExecutorControllerOutcomes.Idempotent, claimId: claimed.claim.claimId, workloadUid: claimed.workloadUid };
	});
}

/** Runs assignment, release, and terminal cleanup reconciliation until process shutdown. */
export async function __RunMcpExecutorController(options: McpExecutorControllerOptions, signal: AbortSignal): Promise<void>
{
	if (!Number.isSafeInteger(options.pollIntervalMilliseconds) || options.pollIntervalMilliseconds < 100 || options.pollIntervalMilliseconds > 60_000)
		throw new Error("MCP executor controller poll interval must be between 100 and 60000ms");
	while (!signal.aborted)
	{
		let didWork = false;
		try
		{
			const result = await __ReconcileNextMcpExecutorWorkload(options, signal);
			didWork = result.outcome !== McpExecutorControllerOutcomes.Idle;
		}
		catch (err)
		{
			if (signal.aborted)
				break;
			options.log.error({ err }, "MCP executor assignment reconciliation failed");
		}
		try
		{
			const result = await __ReconcileNextMcpExecutorRelease(options, signal);
			didWork = didWork || (result.outcome !== McpExecutorControllerOutcomes.Idle && result.outcome !== McpExecutorControllerOutcomes.PendingPod);
		}
		catch (err)
		{
			if (signal.aborted)
				break;
			options.log.error({ err }, "MCP executor release reconciliation failed");
		}
		try
		{
			const result = await __ReconcileNextMcpExecutorCleanup(options, signal);
			didWork = didWork || result.outcome !== McpExecutorControllerOutcomes.Idle;
		}
		catch (err)
		{
			if (signal.aborted)
				break;
			options.log.error({ err }, "MCP executor cleanup reconciliation failed");
		}
		if (!signal.aborted && !didWork)
			await _Wait(options.pollIntervalMilliseconds, signal);
	}
}

/** Waits for the next poll but ends immediately when shutdown begins. */
async function _Wait(milliseconds: number, signal: AbortSignal): Promise<void>
{
	if (signal.aborted)
		return;
	await new Promise<void>(function _WaitForPoll(resolve)
	{
		function _Complete(): void
		{
			clearTimeout(timer);
			signal.removeEventListener("abort", _Complete);
			resolve();
		}
		const timer = setTimeout(_Complete, milliseconds);
		signal.addEventListener("abort", _Complete, { once: true });
	});
}
