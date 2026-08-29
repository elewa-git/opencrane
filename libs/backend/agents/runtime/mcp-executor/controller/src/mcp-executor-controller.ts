import { __BuildSuspendedMcpExecutorJob, type McpExecutorJobProfile } from "@opencrane/backend/agents/runtime/mcp-executor/k8s-launcher";
import { RuntimeWorkloadClaimClasses } from "@opencrane/backend/agents/runtime/workloads/contract";

import { __ReconcileNextMcpExecutorWorkload } from "./mcp-executor-assignment-reconciler";
import { __ReconcileNextMcpExecutorRelease } from "./mcp-executor-release-reconciler";
import { McpExecutorControllerOutcomes, type McpExecutorControllerOptions } from "./mcp-executor-controller.types";
import { _ParseMcpExecutorControllerProfile } from "./mcp-executor-controller.validator";

/** Re-exports assignment reconciliation at the original controller module seam. */
export { __ReconcileNextMcpExecutorWorkload } from "./mcp-executor-assignment-reconciler";
/** Re-exports release reconciliation at the original controller module seam. */
export { __ReconcileNextMcpExecutorRelease } from "./mcp-executor-release-reconciler";

/**
 * Validates the deployment profile that the MCP executor Job builder will consume.
 *
 * Startup uses this before polling so a JSON value that passes its field checks but cannot build a
 * Job stops the controller before it claims work.
 *
 * Called by: apps/agent-controller/src/config.ts.
 * @param value - Parsed deployment configuration for the MCP executor profile.
 * @returns The checked profile ready for controller reconciliation.
 * @throws Error When the profile has unknown fields or the Job builder rejects its configuration.
 */
export function __ValidateMcpExecutorControllerProfile(value: unknown): McpExecutorJobProfile
{
	const profile = _ParseMcpExecutorControllerProfile(value);
	const now = new Date("2026-01-01T00:00:00.000Z");
	__BuildSuspendedMcpExecutorJob({ claim: { claimId: "profile-validation", siloId: "profile-validation", workloadClass: RuntimeWorkloadClaimClasses.McpExecutor, profileName: "mcp-isolated", idempotencyKey: "profile-validation", claimedAt: now.toISOString(), deliveryCount: 1, expiresAt: new Date(now.getTime() + 60_000).toISOString(), executionReference: "profile-validation" }, registryReference: `registry.invalid/opencrane/mcp@sha256:${"a".repeat(64)}`, namespace: profile.namespace }, profile, now);
	return profile;
}

/**
 * Runs assignment and release reconciliation until process shutdown.
 *
 * Each pass logs an assignment or release failure and continues with the other kind of work. It
 * waits only after both passes find no work, so a queued release does not wait behind an idle
 * assignment poll.
 *
 * Called by: apps/agent-controller/src/controller-runtime.ts.
 * @param options - The server authority, Kubernetes store, deployment profile, poll interval, and logger.
 * @param signal - The process drain signal that stops requests and polling.
 * @returns A promise that settles after the signal aborts the polling loop.
 * @throws Error When the configured poll interval is outside the supported range.
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
