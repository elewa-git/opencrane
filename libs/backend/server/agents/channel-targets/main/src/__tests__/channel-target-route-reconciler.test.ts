import type { Logger } from "@opencrane/backend/observability";
import { afterEach, describe, expect, it, vi } from "vitest";

import { __ReconcileChannelTargetRoutes, __StartChannelTargetRouteReconciler } from "../channel-target-route-reconciler";
import type { ChannelTargetRouteReconcilerDependencies } from "../channel-target-route-reconciler.types";

/** Build one package-owned route worker around a controlled repository. */
function _Dependencies(reconcileRuntimeRoutes = vi.fn().mockResolvedValue(1)): ChannelTargetRouteReconcilerDependencies
{
	return { repository: { reconcileRuntimeRoutes }, command: { receiverId: "receiver-1", endpoint: "http://runtime.silo.svc.cluster.local/events", action: "events.read", allowedRouteHostSuffixes: [".svc.cluster.local"] }, logger: { debug: vi.fn(), error: vi.fn() } as unknown as Logger, intervalMilliseconds: 10 };
}

describe("channel target route reconciler", function _DescribeChannelTargetRouteReconciler()
{
	afterEach(function _RestoreTimers() { vi.useRealTimers(); });

	it("retries a failed pass and reports structured failure", async function _RetriesFailure()
	{
		vi.useFakeTimers();
		const failure = new Error("authority unavailable");
		const reconcile = vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce(2);
		const dependencies = _Dependencies(reconcile);
		const worker = __StartChannelTargetRouteReconciler(dependencies);

		await vi.advanceTimersByTimeAsync(20);

		expect(reconcile).toHaveBeenCalledTimes(2);
		expect(dependencies.logger.error).toHaveBeenCalledWith({ err: failure }, "channel target route reconciliation failed");
		await worker.stop();
	});

	it("does not overlap passes and drains the active pass on stop", async function _DrainsActivePass()
	{
		vi.useFakeTimers();
		let finish: (() => void) | undefined;
		const reconcile = vi.fn(function _Reconcile() { return new Promise<number>(function _Wait(resolve) { finish = function _Finish() { resolve(1); }; }); });
		const worker = __StartChannelTargetRouteReconciler(_Dependencies(reconcile));
		await vi.advanceTimersByTimeAsync(30);

		expect(reconcile).toHaveBeenCalledTimes(1);
		const stopped = worker.stop();
		finish?.();
		await stopped;
	});

	it("treats disabled reconciliation as an explicit no-op", async function _DisablesReconciliation()
	{
		const dependencies = { ..._Dependencies(), command: null };

		await expect(__ReconcileChannelTargetRoutes(dependencies)).resolves.toBe(0);
		await expect(__StartChannelTargetRouteReconciler(dependencies).stop()).resolves.toBeUndefined();
		expect(dependencies.repository.reconcileRuntimeRoutes).not.toHaveBeenCalled();
	});
});
