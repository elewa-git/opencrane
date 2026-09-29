import type { Server } from "node:http";

import type { PrismaClient } from "@prisma/client";
import type { Express } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { IWorkflowWorkerRuntime } from "@opencrane/backend/server/infra/workflows/contract";

import type { OpenCraneProcessConfig } from "../../configuration/config.types";
import type { OpenCraneHistoryStoreComposition } from "@opencrane/backend/server/infra/history-store";
import type { OpenCraneStartupRecovery, OpenCraneStartupWorkerFactory } from "../lifecycle.types";

/** Ordered lifecycle calls shared by hoisted dependency mocks and assertions. */
const _calls = vi.hoisted(function _Calls() { return [] as string[]; });
const _workerFailures = vi.hoisted(function _WorkerFailures() { return { start: null as Error | null, stop: null as Error | null }; });

vi.mock("@opencrane/backend/observability", function _Observability()
{
	return { ___ShutdownTelemetry: async function _ShutdownTelemetry() { _calls.push("telemetry"); } };
});

vi.mock("../background-workers", function _BackgroundWorkers()
{
	return { _StartBackgroundWorkers: async function _StartBackgroundWorkers() { _calls.push("workers.start"); if (_workerFailures.start)
		throw _workerFailures.start; return { stop: async function _StopWorkers() { _calls.push("workers"); if (_workerFailures.stop)
		throw _workerFailures.stop; } }; } };
});

vi.mock("../log", function _Log()
{
	return { _log: { info: function _Info() {}, error: function _Error() {} } };
});

vi.mock("../process-shutdown", function _ProcessShutdown()
{
	return { _BeginProcessShutdown: function _BeginProcessShutdown() { _calls.push("streams"); } };
});

import { _CloseFailedProcessStartup, _OwnProcessStartupComposition, _StartProcessLifecycle } from "../lifecycle";

/** Signal listeners registered by the current test and removed after it completes. */
const _registeredListeners: Array<{ readonly signal: NodeJS.Signals; readonly listener: NodeJS.SignalsListener }> = [];

afterEach(function _RestoreProcess()
{
	for (const registered of _registeredListeners) process.removeListener(registered.signal, registered.listener);
	_registeredListeners.length = 0;
	vi.restoreAllMocks();
	_calls.length = 0;
	_workerFailures.start = null;
	_workerFailures.stop = null;
});

/** Build one fake listener that records its close before resolving. */
function _Server(name: string): Server
{
	return { close: function _Close(callback?: (error?: Error) => void) { _calls.push(name); callback?.(); return this; } } as unknown as Server;
}

/** Build one minimal Express seam that records listener binding and returns its fake server. */
function _App(server: Server, marker: string): Express
{
	return { listen: function _Listen(_port: number, callback?: () => void) { _calls.push(marker); callback?.(); return server; } } as unknown as Express;
}

/** Builds one closeable HistoryStore composition that records lifecycle ownership. */
function _HistoryStore(): OpenCraneHistoryStoreComposition
{
	return { close: async function _CloseHistoryStore() { _calls.push("history"); }, historyStore: {} as OpenCraneHistoryStoreComposition["historyStore"] };
}

/** Builds a no-op startup repair for lifecycle cases that exercise another boundary. */
function _Startup(): OpenCraneStartupRecovery
{
	return { repairAllActiveSchedules: async function _Repair(): Promise<number> { return 0; } };
}

/** Builds deferred computer workers that expose their start and stop ordering. */
function _StartupWorkers(): OpenCraneStartupWorkerFactory
{
	return { start: async function _Start() { _calls.push("computers.start"); return { stop: async function _Stop() { _calls.push("computers"); } }; } };
}

describe("OpenCrane process lifecycle", function _LifecycleSuite()
{
	it("closes startup dependencies and flushes telemetry when durable workers cannot start", async function _StartupFailureCleanup()
	{
		_workerFailures.start = new Error("worker unavailable");
		const prisma = { $disconnect: async function _Disconnect() { _calls.push("prisma"); } } as unknown as PrismaClient;
		const workflowRuntime = { close: async function _CloseWorkflow() { _calls.push("workflow"); } } as IWorkflowWorkerRuntime;

		await expect(_StartProcessLifecycle(
			_App(_Server("public"), "public.listen"), _App(_Server("internal"), "internal.listen"), prisma,
			{ publicPort: 8080, internalPort: 8081 } as OpenCraneProcessConfig,
			function _UnbindConsole() { _calls.push("console"); },
			{ recoverExpiredInvocation: vi.fn() } as never, workflowRuntime, {} as never, _HistoryStore(), _Startup(),
			_StartupWorkers(),
		)).rejects.toThrow("worker unavailable");

		expect(_calls).toEqual(expect.arrayContaining(["computers.start", "workers.start", "computers", "workflow", "history", "prisma", "telemetry", "console"]));
		expect(_calls.indexOf("history")).toBeLessThan(_calls.indexOf("telemetry"));
		expect(_calls.indexOf("prisma")).toBeLessThan(_calls.indexOf("telemetry"));
		expect(_calls.at(-1)).toBe("console");
		expect(_calls).not.toContain("public.listen");
		expect(_calls).not.toContain("internal.listen");
	});

	it("repairs routine schedules before workers start", async function _StartupRepairOrder()
	{
		const previousTerm = new Set(process.listeners("SIGTERM"));
		const previousInt = new Set(process.listeners("SIGINT"));
		const startup = { repairAllActiveSchedules: async function _Repair(): Promise<number> { _calls.push("routines.repair"); return 2; } };
		await _StartProcessLifecycle(
			_App(_Server("public"), "public.listen"), _App(_Server("internal"), "internal.listen"), {} as PrismaClient,
			{ publicPort: 8080, internalPort: 8081 } as OpenCraneProcessConfig,
			function _UnbindConsole() { _calls.push("console"); },
			{ recoverExpiredInvocation: vi.fn() } as never, {} as IWorkflowWorkerRuntime, {} as never, _HistoryStore(), startup,
			_StartupWorkers(),
		);

		const term = process.listeners("SIGTERM").find(function _New(listener) { return !previousTerm.has(listener); });
		const interrupt = process.listeners("SIGINT").find(function _New(listener) { return !previousInt.has(listener); });
		if (term === undefined || interrupt === undefined)
			throw new Error("lifecycle did not register process signal handlers");
		_registeredListeners.push({ signal: "SIGTERM", listener: term }, { signal: "SIGINT", listener: interrupt });
		expect(_calls.indexOf("routines.repair")).toBeLessThan(_calls.indexOf("workers.start"));
		expect(_calls.indexOf("routines.repair")).toBeLessThan(_calls.indexOf("computers.start"));
		expect(_calls.indexOf("computers.start")).toBeLessThan(_calls.indexOf("workers.start"));
		expect(_calls.indexOf("workers.start")).toBeLessThan(_calls.indexOf("public.listen"));
		expect(_calls.indexOf("workers.start")).toBeLessThan(_calls.indexOf("internal.listen"));
	});

	it("closes startup dependencies without binding listeners when routine repair fails", async function _StartupRepairFailure()
	{
		const prisma = { $disconnect: async function _Disconnect() { _calls.push("prisma"); } } as unknown as PrismaClient;
		const workflowRuntime = { close: async function _CloseWorkflow() { _calls.push("workflow"); } } as IWorkflowWorkerRuntime;
		const startup = { repairAllActiveSchedules: async function _Repair(): Promise<number> { _calls.push("routines.repair"); throw new Error("repair failed"); } };

		await expect(_StartProcessLifecycle(
			_App(_Server("public"), "public.listen"), _App(_Server("internal"), "internal.listen"), prisma,
			{ publicPort: 8080, internalPort: 8081 } as OpenCraneProcessConfig,
			function _UnbindConsole() { _calls.push("console"); },
			{ recoverExpiredInvocation: vi.fn() } as never, workflowRuntime, {} as never, _HistoryStore(), startup,
			_StartupWorkers(),
		)).rejects.toThrow("repair failed");

		expect(_calls).toEqual(expect.arrayContaining(["routines.repair", "workflow", "history", "prisma", "telemetry", "console"]));
		expect(_calls).not.toContain("workers.start");
		expect(_calls).not.toContain("computers.start");
		expect(_calls).not.toContain("public.listen");
		expect(_calls).not.toContain("internal.listen");
	});

	it("closes inputs before draining workers and flushes telemetry after durable dependencies close", async function _ShutdownOrder()
	{
		const previousTerm = new Set(process.listeners("SIGTERM"));
		const previousInt = new Set(process.listeners("SIGINT"));
		const exit = vi.spyOn(process, "exit").mockImplementation(function _Exit() { _calls.push("exit"); return undefined as never; });
		const prisma = { $disconnect: async function _Disconnect() { _calls.push("prisma"); } } as unknown as PrismaClient;

		await _StartProcessLifecycle(
			_App(_Server("public"), "public.listen"),
			_App(_Server("internal"), "internal.listen"),
			prisma,
		{ publicPort: 8080, internalPort: 8081 } as OpenCraneProcessConfig,
		function _UnbindConsole() { _calls.push("console"); },
			{ recoverExpiredInvocation: vi.fn() } as never,
			{} as IWorkflowWorkerRuntime,
			{} as never,
			_HistoryStore(),
			_Startup(),
			_StartupWorkers(),
		);

		const term = process.listeners("SIGTERM").find(function _New(listener) { return !previousTerm.has(listener); });
		const interrupt = process.listeners("SIGINT").find(function _New(listener) { return !previousInt.has(listener); });
		if (term === undefined || interrupt === undefined)
			throw new Error("lifecycle did not register process signal handlers");
		_registeredListeners.push({ signal: "SIGTERM", listener: term }, { signal: "SIGINT", listener: interrupt });
		expect(_calls).toContain("workers.start");
		term("SIGTERM");

		await vi.waitFor(function _Exited() { expect(exit).toHaveBeenCalledWith(0); });
		expect(_calls.indexOf("streams")).toBeLessThan(_calls.indexOf("workers"));
		expect(_calls.indexOf("workers")).toBeLessThan(_calls.indexOf("prisma"));
		expect(_calls.indexOf("history")).toBeLessThan(_calls.indexOf("prisma"));
		expect(_calls.indexOf("prisma")).toBeLessThan(_calls.indexOf("telemetry"));
		expect(_calls.slice(-3)).toEqual(["telemetry", "console", "exit"]);
	});

	it("flushes telemetry and exits non-zero when durable worker drain fails", async function _FailedDrainExit()
	{
		_workerFailures.stop = new Error("drain failed");
		const previousTerm = new Set(process.listeners("SIGTERM"));
		const previousInt = new Set(process.listeners("SIGINT"));
		const exit = vi.spyOn(process, "exit").mockImplementation(function _Exit() { _calls.push("exit"); return undefined as never; });
		const prisma = { $disconnect: async function _Disconnect() { _calls.push("prisma"); } } as unknown as PrismaClient;

		await _StartProcessLifecycle(_App(_Server("public"), "public.listen"), _App(_Server("internal"), "internal.listen"), prisma, { publicPort: 8080, internalPort: 8081 } as OpenCraneProcessConfig, function _Unbind()
 { _calls.push("console"); }, { recoverExpiredInvocation: vi.fn() } as never, {} as IWorkflowWorkerRuntime, {} as never, _HistoryStore(), _Startup(), _StartupWorkers());
		const term = process.listeners("SIGTERM").find(function _New(listener) { return !previousTerm.has(listener); });
		const interrupt = process.listeners("SIGINT").find(function _New(listener) { return !previousInt.has(listener); });
		if (term === undefined || interrupt === undefined)
			throw new Error("lifecycle did not register process signal handlers");
		_registeredListeners.push({ signal: "SIGTERM", listener: term }, { signal: "SIGINT", listener: interrupt });
		term("SIGTERM");

		await vi.waitFor(function _Exited() { expect(exit).toHaveBeenCalledWith(1); });
		expect(_calls.indexOf("prisma")).toBeLessThan(_calls.indexOf("telemetry"));
		expect(_calls.slice(-3)).toEqual(["telemetry", "console", "exit"]);
	});

	it("cleans the process when later pre-lifecycle assembly fails", async function _AssemblyFailure()
	{
		const cleanup = vi.fn(async function _Cleanup() { _calls.push("cleanup"); });
		await expect(_OwnProcessStartupComposition(async function _Compose()
		{
			_calls.push("routine.register");
			_calls.push("conversation.register");
			throw new Error("router assembly failed");
		}, cleanup)).rejects.toThrow("router assembly failed");

		expect(_calls).toEqual(["routine.register", "conversation.register", "cleanup"]);
		expect(cleanup).toHaveBeenCalledOnce();
	});

	it("forces a failed startup exit when dependency cleanup hangs", async function _HangingCleanup()
	{
		vi.useFakeTimers();
		const exit = vi.spyOn(process, "exit").mockImplementation(function _Exit() { return undefined as never; });
		let releaseHistory: (() => void) | undefined;
		const historyStore = { close: function _CloseHistory() { return new Promise<void>(function _Wait(resolve) { releaseHistory = resolve; }); }, historyStore: {} } as OpenCraneHistoryStoreComposition;
		const cleanup = _CloseFailedProcessStartup({ $disconnect: vi.fn(async function _Disconnect() {}) } as unknown as PrismaClient, null, historyStore, vi.fn());

		await vi.advanceTimersByTimeAsync(10_000);
		expect(exit).toHaveBeenCalledWith(1);
		releaseHistory?.();
		await cleanup;
		vi.useRealTimers();
	});
});
