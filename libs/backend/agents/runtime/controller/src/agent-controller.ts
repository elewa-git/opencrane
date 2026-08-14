import { _AgentControllerProfilesAreBoundToDistinctNamespaces } from "./agent-controller-profiles";
import { AgentControllerReconcileOutcomes, type AgentControllerOptions } from "./agent-controller.types";
import { __ReconcileNextAgentRuntimeAttempt } from "./agent-runtime-attempt-assignment";
import { __ReconcileNextRuntimeRelease } from "./agent-runtime-release";

/** Sleep until the next poll, but return as soon as shutdown starts instead of waiting the timer out. */
async function _Wait(milliseconds: number, signal: AbortSignal): Promise<void>
{
	if (signal.aborted) return;
	await new Promise<void>(function _wait(resolve)
	{
		/** End the wait once, clearing the timer and removing the abort listener. */
		function _CompleteWait(): void
		{
			clearTimeout(timer);
			signal.removeEventListener("abort", _CompleteWait);
			resolve();
		}
		const timer = setTimeout(_CompleteWait, milliseconds);
		signal.addEventListener("abort", _CompleteWait, { once: true });
	});
}

/** Run both reconciliations, one after the other, and return whether either got any work done. Each failure is logged and swallowed so it cannot stop the other. */
async function _ReconcileRuntimeWork(options: AgentControllerOptions, signal: AbortSignal): Promise<boolean>
{
	let didWork = false;
	try
	{
		const assignment = await __ReconcileNextAgentRuntimeAttempt(options, signal);
		didWork = assignment.outcome !== AgentControllerReconcileOutcomes.Idle;
	}
	catch (err)
	{
		if (signal.aborted) return false;
		options.log.error({ err }, "agent controller attempt reconciliation failed");
	}
	try
	{
		const release = await __ReconcileNextRuntimeRelease(options, signal);
		didWork = didWork || (release.outcome !== AgentControllerReconcileOutcomes.Idle && release.outcome !== AgentControllerReconcileOutcomes.PendingPod);
	}
	catch (err)
	{
		if (signal.aborted) return false;
		options.log.error({ err }, "agent controller workload-release reconciliation failed");
	}
	return didWork;
}

/** Delete the outbox records whose retention has expired, logging any failure instead of stopping the loop. */
async function _PrunePublishedOutbox(options: AgentControllerOptions, signal: AbortSignal): Promise<void>
{
	if (!options.authority.__PrunePublishedOutbox) return;
	try
	{
		const deletedCount = await options.authority.__PrunePublishedOutbox(signal);
		if (deletedCount > 0) options.log.info({ deletedCount }, "retention-expired runtime outbox records pruned");
	}
	catch (err)
	{
		if (!signal.aborted) options.log.error({ err }, "agent controller outbox retention failed");
	}
}

/**
 * Poll OpenCrane until shutdown, advancing assignment and release as separate durable claims.
 *
 * Reconciliation failures remain isolated to one poll. The loop never repairs, replaces, or
 * deletes a mismatching Kubernetes object because doing so would hide authority drift.
 * @param options - Fixed authority, profile, adapter, interval, and logger dependencies.
 * @param signal - Process shutdown signal.
 */
export async function __RunAgentController(options: AgentControllerOptions, signal: AbortSignal): Promise<void>
{
	const outboxPruneIntervalMilliseconds = options.outboxPruneIntervalMilliseconds ?? 3_600_000;
	if (!_AgentControllerProfilesAreBoundToDistinctNamespaces(options.profiles) || !Number.isSafeInteger(options.pollIntervalMilliseconds) || options.pollIntervalMilliseconds < 100 || options.pollIntervalMilliseconds > 60_000 || !Number.isSafeInteger(outboxPruneIntervalMilliseconds) || outboxPruneIntervalMilliseconds < 60_000 || outboxPruneIntervalMilliseconds > 86_400_000)
	{
		throw new Error("agent controller requires distinct profile runtime namespaces, 100-60000ms poll interval, and 60s-24h outbox prune interval");
	}
	let nextOutboxPruneAt = Date.now();
	while (!signal.aborted)
	{
		// 1. Advance assignment and release independently so one failed claim cannot starve the other.
		const didWork = await _ReconcileRuntimeWork(options, signal);
		if (signal.aborted) break;

		// 2. Prune the outbox on its own slower schedule; it must never decide when the loop polls again.
		if (Date.now() >= nextOutboxPruneAt)
		{
			await _PrunePublishedOutbox(options, signal);
			nextOutboxPruneAt = Date.now() + outboxPruneIntervalMilliseconds;
		}

		// 3. Don't start a sleep timer after shutdown, and skip the sleep entirely while work keeps coming.
		if (signal.aborted) break;
		if (didWork) continue;
		await _Wait(options.pollIntervalMilliseconds, signal);
	}
}
