import type { ChannelTargetRouteReconciler, ChannelTargetRouteReconcilerDependencies } from "./channel-target-route-reconciler.types.js";

/** Reconcile the current deployment route set once, or no-op when the capability is disabled. */
export async function __ReconcileChannelTargetRoutes(dependencies: ChannelTargetRouteReconcilerDependencies): Promise<number>
{
	if (dependencies.command === null) return 0;
	return dependencies.repository.reconcileRuntimeRoutes(dependencies.command);
}

/** Start a bounded non-overlapping reconciliation loop whose next pass retries handled failures. */
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
