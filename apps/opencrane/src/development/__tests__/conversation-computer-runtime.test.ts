import { EventEmitter } from "node:events";

import { afterEach, describe, expect, it, vi } from "vitest";

import { DevelopmentConversationComputerRuntime } from "../conversation-computer-runtime";
import { _StartDevelopmentServer } from "../lifecycle";

/** Creates one idempotent worker handle around a controlled stop function. */
function _Handle(stop = vi.fn().mockResolvedValue(undefined))
{
	return { stop };
}

describe("Tier 2 conversation-computer startup order", function _Suite(): void
{
	afterEach(function _RestoreTimers(): void
	{
		vi.useRealTimers();
	});

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
		expect(order).toEqual([
			"reconcile",
			"activate",
			"private-listener",
		]);
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
		expect(order).toEqual([
			"workflow-workers",
			"conversation-computer",
			"public-listener",
		]);
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
		expect(order).toEqual([
			"activation-stop",
			"lifecycle-stop",
			"listener-stop",
		]);
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

	it("serializes provider reconciliation and drains it before resource cleanup", async function _DrainsProviderPass(): Promise<void>
	{
		vi.useFakeTimers();
		const order: string[] = [];
		let finishProviderPass = function _MissingProviderPass(): void
		{
			throw new Error("Provider reconciliation pass did not start");
		};
		const providerPass = new Promise<boolean>(function _BlockProviderPass(resolve): void
		{
			finishProviderPass = function _FinishProviderPass(): void
			{
				order.push("provider-settled");
				resolve(false);
			};
		});
		const reconcileNext = vi.fn().mockReturnValue(providerPass);
		const server = Object.assign(new EventEmitter(), {
			close: vi.fn(function _Close(callback): void
			{
				order.push("server-close");
				callback();
			}),
		});
		const composition = {
			app: {
				listen: vi.fn(function _Listen()
				{
					void Promise.resolve().then(function _Ready(): void { server.emit("listening"); });
					return server;
				}),
			},
			conversationComputer: null,
			historyStore: { close: vi.fn(async function _CloseHistory(): Promise<void> { order.push("history-close"); }) },
			prisma: { $disconnect: vi.fn(async function _Disconnect(): Promise<void> { order.push("prisma-disconnect"); }) },
			providerEffects: { reconcileNext },
			workflowRuntime: {
				startWorkers: vi.fn().mockResolvedValue(undefined),
				close: vi.fn(async function _CloseWorkflow(): Promise<void> { order.push("workflow-close"); }),
			},
		};
		const handle = await _StartDevelopmentServer(composition as never, 8080);

		await vi.advanceTimersByTimeAsync(1_000);
		expect(reconcileNext).toHaveBeenCalledOnce();
		await vi.advanceTimersByTimeAsync(4_000);
		expect(reconcileNext).toHaveBeenCalledOnce();

		const stopping = handle.stop();
		await Promise.resolve();
		expect(server.close).not.toHaveBeenCalled();
		expect(composition.historyStore.close).not.toHaveBeenCalled();
		expect(composition.prisma.$disconnect).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(4_000);
		expect(reconcileNext).toHaveBeenCalledOnce();

		finishProviderPass();
		await stopping;
		expect(order).toEqual([
			"provider-settled",
			"server-close",
			"workflow-close",
			"history-close",
			"prisma-disconnect",
		]);
	});
});
