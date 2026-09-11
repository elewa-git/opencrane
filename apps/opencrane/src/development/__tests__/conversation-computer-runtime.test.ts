import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

import { DevelopmentConversationComputerRuntime } from "../conversation-computer-runtime";
import { _StartDevelopmentServer } from "../lifecycle";

/** Creates one idempotent worker handle around a controlled stop function. */
function _Handle(stop = vi.fn().mockResolvedValue(undefined))
{
	return { stop };
}

describe("Tier 2 conversation-computer startup order", function _Suite(): void
{
	it("finishes retained-state reconciliation before activation and the private listener", async function _OrdersPrivateRuntime(): Promise<void>
	{
		const order: string[] = [];
		let finishReconciliation = function _MissingReconciliation(_handle: ReturnType<typeof _Handle>): void
		{
			throw new Error("Lifecycle start did not expose its reconciliation boundary");
		};
		const startLifecycle = vi.fn(function _Reconcile()
		{
			order.push("reconcile");
			return new Promise<ReturnType<typeof _Handle>>(function _Waiting(resolve): void { finishReconciliation = resolve; });
		});
		const startActivations = vi.fn(async function _Activate()
		{
			order.push("activate");
			return _Handle();
		});
		const privateListener = {
			start: vi.fn(async function _Listen()
			{
				order.push("private-listener");
				return _Handle();
			}),
			stop: vi.fn().mockResolvedValue(undefined),
		};
		const starting = new DevelopmentConversationComputerRuntime(startLifecycle, startActivations, privateListener as never).start();
		await Promise.resolve();
		expect(order).toEqual(["reconcile"]);
		expect(startActivations).not.toHaveBeenCalled();
		finishReconciliation(_Handle());
		const handle = await starting;
		expect(order).toEqual(["reconcile", "activate", "private-listener"]);
		await handle.stop();
	});

	it("does not open the public listener until the conversation computer has started", async function _OrdersPublicRuntime(): Promise<void>
	{
		const order: string[] = [];
		const server = Object.assign(new EventEmitter(), {
			close: vi.fn(function _Close(callback): void { callback(); }),
		});
		const app = {
			listen: vi.fn(function _Listen()
			{
				order.push("public-listener");
				queueMicrotask(function _Ready(): void { server.emit("listening"); });
				return server;
			}),
		};
		const composition = {
			app,
			conversationComputer: { start: vi.fn(async function _StartComputer()
			{
				order.push("conversation-computer");
				return _Handle();
			}) },
			historyStore: { close: vi.fn().mockResolvedValue(undefined) },
			prisma: { $disconnect: vi.fn().mockResolvedValue(undefined) },
			providerEffects: { reconcileNext: vi.fn().mockResolvedValue(undefined) },
			workflowRuntime: {
				startWorkers: vi.fn(async function _StartWorkers(): Promise<void> { order.push("workflow-workers"); }),
				close: vi.fn().mockResolvedValue(undefined),
			},
		};
		const handle = await _StartDevelopmentServer(composition as never, 8080);
		expect(order).toEqual(["workflow-workers", "conversation-computer", "public-listener"]);
		await handle.stop();
	});

	it("drains startup workers before closing the failed private listener", async function _OrdersStartupCleanup(): Promise<void>
	{
		const order: string[] = [];
		let finishActivationStop = function _MissingActivationStop(): void { throw new Error("Activation stop did not start"); };
		const activationStop = vi.fn(function _StopActivation(): Promise<void>
		{
			order.push("activation-stop");
			return new Promise<void>(function _Waiting(resolve): void { finishActivationStop = resolve; });
		});
		const lifecycleStop = vi.fn(async function _StopLifecycle(): Promise<void> { order.push("lifecycle-stop"); });
		const listenerStop = vi.fn(async function _StopListener(): Promise<void> { order.push("listener-stop"); });
		const runtime = new DevelopmentConversationComputerRuntime(
			async function _Lifecycle() { return _Handle(lifecycleStop); },
			async function _Activations() { return _Handle(activationStop); },
			{ start: vi.fn().mockRejectedValue(new Error("private port occupied")), stop: listenerStop } as never,
		);
		const starting = runtime.start();
		await vi.waitFor(function _WorkersDraining(): void { expect(activationStop).toHaveBeenCalledOnce(); });
		expect(order).toEqual(["activation-stop", "lifecycle-stop"]);
		expect(listenerStop).not.toHaveBeenCalled();
		finishActivationStop();

		await expect(starting).rejects.toThrow("private port occupied");
		expect(order).toEqual(["activation-stop", "lifecycle-stop", "listener-stop"]);
	});

	it("finishes every runtime cleanup stage and reports worker failures", async function _ReportsRuntimeCleanupFailure(): Promise<void>
	{
		const activationStop = vi.fn().mockRejectedValue(new Error("activation stop failed"));
		const lifecycleStop = vi.fn().mockResolvedValue(undefined);
		const listenerStop = vi.fn().mockResolvedValue(undefined);
		const runtime = new DevelopmentConversationComputerRuntime(
			async function _Lifecycle() { return _Handle(lifecycleStop); },
			async function _Activations() { return _Handle(activationStop); },
			{ start: vi.fn().mockResolvedValue(_Handle()), stop: listenerStop } as never,
		);
		const handle = await runtime.start();

		await expect(handle.stop()).rejects.toThrow("Tier 2 conversation-computer runtime cleanup failed");
		expect(activationStop).toHaveBeenCalledOnce();
		expect(lifecycleStop).toHaveBeenCalledOnce();
		expect(listenerStop).toHaveBeenCalledOnce();
	});
});
