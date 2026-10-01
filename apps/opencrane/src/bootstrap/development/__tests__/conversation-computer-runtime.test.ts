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

	it("finishes retained-state reconciliation before activation", async function _OrdersPrivateRuntime(): Promise<void>
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
		const processes = {
			stop: vi.fn().mockResolvedValue(undefined),
		};
		const starting = new DevelopmentConversationComputerRuntime(startLifecycle, startActivations, processes).start();
		await Promise.resolve();
		expect(order).toEqual(["reconcile"]);
		expect(startActivations).not.toHaveBeenCalled();
		finishReconciliation(_Handle());
		const handle = await starting;
		expect(order).toEqual([
			"reconcile",
			"activate",
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

	it("closes processes when activation startup fails", async function _OrdersStartupCleanup(): Promise<void>
	{
		const order: string[] = [];
		const lifecycleStop = vi.fn(async function _StopLifecycle(): Promise<void> { order.push("lifecycle-stop"); });
		const processStop = vi.fn(async function _StopProcesses(): Promise<void> { order.push("process-stop"); });
		const runtime = new DevelopmentConversationComputerRuntime(
			async function _Lifecycle() { return _Handle(lifecycleStop); },
			async function _Activations() { throw new Error("activation failed"); },
			{ stop: processStop },
		);
		await expect(runtime.start()).rejects.toThrow("activation failed");
		expect(order).toEqual([
			"lifecycle-stop",
			"process-stop",
		]);
	});

	it("finishes every runtime cleanup stage and reports worker failures", async function _ReportsRuntimeCleanupFailure(): Promise<void>
	{
		const activationStop = vi.fn().mockRejectedValue(new Error("activation stop failed"));
		const lifecycleStop = vi.fn().mockResolvedValue(undefined);
		const processStop = vi.fn().mockResolvedValue(undefined);
		const runtime = new DevelopmentConversationComputerRuntime(
			async function _Lifecycle() { return _Handle(lifecycleStop); },
			async function _Activations() { return _Handle(activationStop); },
			{ stop: processStop },
		);
		const handle = await runtime.start();

		await expect(handle.stop()).rejects.toThrow("Tier 2 conversation-computer runtime cleanup failed");
		expect(activationStop).toHaveBeenCalledOnce();
		expect(lifecycleStop).toHaveBeenCalledOnce();
		expect(processStop).toHaveBeenCalledOnce();
	});

	it("preserves each worker receiver while stopping the runtime", async function _PreservesWorkerReceivers(): Promise<void>
	{
		class _Worker
		{
			public stopped = false;

			public async stop(): Promise<void>
			{
				this.stopped = true;
			}
		}

		const lifecycle = new _Worker();
		const activations = new _Worker();
		const processes = { stop: vi.fn().mockResolvedValue(undefined) };
		const runtime = new DevelopmentConversationComputerRuntime(
			async function _Lifecycle() { return lifecycle; },
			async function _Activations() { return activations; },
			processes,
		);
		const handle = await runtime.start();

		await handle.stop();
		expect(activations.stopped).toBe(true);
		expect(lifecycle.stopped).toBe(true);
		expect(processes.stop).toHaveBeenCalledOnce();
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
