import { __BuildSuspendedMcpExecutorJob, type McpExecutorJobProfile } from "@opencrane/backend/agents/runtime/mcp-executor/k8s-launcher";
import { RuntimeWorkloadClaimClasses } from "@opencrane/backend/agents/runtime/workloads/contract";
import { ___DoWithTrace } from "@opencrane/backend/observability";

import { __ReconcileNextMcpExecutorWorkload } from "./mcp-executor-assignment-reconciler";
import { __ReconcileNextMcpExecutorRelease } from "./mcp-executor-release-reconciler";
import { McpExecutorControllerOutcomes, type McpExecutorControllerCleanupResult, type McpExecutorControllerOptions } from "./mcp-executor-controller.types";
import { _ParseMcpExecutorControllerProfile } from "./mcp-executor-controller.validator";

/** Re-exports assignment reconciliation at the established controller module boundary. */
export { __ReconcileNextMcpExecutorWorkload } from "./mcp-executor-assignment-reconciler";
/** Re-exports release reconciliation at the established controller module boundary. */
export { __ReconcileNextMcpExecutorRelease } from "./mcp-executor-release-reconciler";

/**
 * Validates the deployment profile before the controller claims MCP work.
 *
 * A strict schema rejects unknown configuration, then the pure Job builder checks the Kubernetes
 * policy that depends on several profile fields together. Startup fails before any database claim
 * when either check rejects the profile.
 *
 * Called by: apps/agent-controller/src/config.ts.
 * @param value - Parsed JSON from the deployment-owned MCP executor profile.
 * @returns The checked profile ready for assignment, release, and cleanup reconciliation.
 * @throws Error When the profile shape or projected Job policy is invalid.
 */
export function __ValidateMcpExecutorControllerProfile(value: unknown): McpExecutorJobProfile
{
	const profile = _ParseMcpExecutorControllerProfile(value);
	const now = new Date("2026-01-01T00:00:00.000Z");
	__BuildSuspendedMcpExecutorJob({ claim: { claimId: "profile-validation", siloId: "profile-validation", workloadClass: RuntimeWorkloadClaimClasses.McpExecutor, profileName: "mcp-isolated", idempotencyKey: "profile-validation", claimedAt: now.toISOString(), deliveryCount: 1, expiresAt: new Date(now.getTime() + 60_000).toISOString(), executionReference: "profile-validation" }, registryReference: `registry.invalid/opencrane/mcp@sha256:${"a".repeat(64)}`, namespace: profile.namespace }, profile, now);
	return profile;
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

/**
 * Runs MCP assignment, release, and terminal-cleanup passes until process shutdown.
 *
 * Each pass handles its own failure so a broken assignment cannot prevent release or cleanup. The
 * loop waits only when no pass made progress, preserving prompt cleanup of terminal executor Jobs.
 *
 * Called by: apps/agent-controller/src/index.ts.
 * @param options - Authority, Kubernetes store, fixed profile, poll interval, and logger.
 * @param signal - Process drain signal that stops requests and polling.
 * @returns A promise that settles after shutdown aborts the loop.
 * @throws Error When the poll interval is outside the supported range.
 */
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
