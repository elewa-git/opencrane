import type { ChannelTargetRouteReconciler, ChannelTargetRouteReconcilerDependencies } from "./channel-target-route-reconciler.types.js";

/** Reconcile the current deployment route set once, or no-op when the capability is disabled. */
export async function __ReconcileChannelTargetRoutes(dependencies: ChannelTargetRouteReconcilerDependencies): Promise<number>
{
	if (dependencies.command === null) return 0;
	return dependencies.repository.reconcileRuntimeRoutes(dependencies.command);
}

/**
 * Start a repeating pass that keeps one route row per AgentService pointing at this deployment's receiver.
 *
 * Services created after startup would otherwise have no route, and every event read for them would
 * be refused with `route_denied` - so the loop re-runs on an interval instead of only once. Passes
 * never overlap: a tick that arrives while a pass is still running is skipped. A failed pass is
 * logged and simply retried by the next one. The timer is unref'd so it cannot keep the process
 * alive, and `stop()` waits for the pass in flight so the repository is not closed underneath it.
 * When the capability is disabled (`command` is null) this returns a handle that does nothing.
 *
 * Called by: apps/opencrane/src/app/channel-target-composition.ts during startup.
 *
 * @param dependencies - Route authority, deployment route command (or null), logger, and interval.
 * @returns A handle whose `stop()` ends the loop and drains the active pass.
 * @throws Error when `intervalMilliseconds` is not a safe integer between 1 and 300000.
 */
export function __StartChannelTargetRouteReconciler(dependencies: ChannelTargetRouteReconcilerDependencies): ChannelTargetRouteReconciler
{
	if (!Number.isSafeInteger(dependencies.intervalMilliseconds) || dependencies.intervalMilliseconds < 1 || dependencies.intervalMilliseconds > 300_000) throw new Error("channel route reconciliation interval is invalid");
	if (dependencies.command === null) return { async stop(): Promise<void> {} };

	let activePass: Promise<void> | null = null;
	let stopping = false;
	function _Reconcile(): void
	{
		if (stopping || activePass !== null) return;
		activePass = __ReconcileChannelTargetRoutes(dependencies)
			.then(function _Reconciled(routeCount) { dependencies.logger.debug({ routeCount }, "channel target routes reconciled"); })
			.catch(function _ReconcileFailed(err: unknown) { dependencies.logger.error({ err }, "channel target route reconciliation failed"); })
			.finally(function _PassFinished() { activePass = null; });
	}

	const handle = setInterval(_Reconcile, dependencies.intervalMilliseconds);
	handle.unref();
	return {
		async stop(): Promise<void>
		{
			stopping = true;
			clearInterval(handle);
			await activePass;
		},
	};
}
