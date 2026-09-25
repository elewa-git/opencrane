import type { Server } from "node:http";

import type { PrismaClient } from "@prisma/client";
import type { Express } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { IWorkflowWorkerRuntime } from "@opencrane/backend/server/infra/workflows/contract";

import type { OpenCraneProcessConfig } from "../../configuration/config.types";
import type { OpenCraneHistoryStoreComposition } from "@opencrane/backend/server/infra/history-store";

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

import { _StartProcessLifecycle } from "../lifecycle";

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

/** Build one minimal Express seam that returns the selected fake HTTP server. */
function _App(server: Server): Express
{
	return { listen: function _Listen(_port: number, callback?: () => void) { callback?.(); return server; } } as unknown as Express;
}

/** Builds one closeable HistoryStore composition that records lifecycle ownership. */
function _HistoryStore(): OpenCraneHistoryStoreComposition
{
	return { close: async function _CloseHistoryStore() { _calls.push("history"); }, historyStore: {} as OpenCraneHistoryStoreComposition["historyStore"] };
}

describe("OpenCrane process lifecycle", function _LifecycleSuite()
{
	it("closes startup dependencies and flushes telemetry when durable workers cannot start", async function _StartupFailureCleanup()
	{
		_workerFailures.start = new Error("worker unavailable");
		const prisma = { $disconnect: async function _Disconnect() { _calls.push("prisma"); } } as unknown as PrismaClient;
		const workflowRuntime = { close: async function _CloseWorkflow() { _calls.push("workflow"); } } as IWorkflowWorkerRuntime;

		await expect(_StartProcessLifecycle(
			_App(_Server("public")), _App(_Server("internal")), prisma,
			{ publicPort: 8080, internalPort: 8081 } as OpenCraneProcessConfig,
			function _UnbindConsole() { _calls.push("console"); },
			{ recoverExpiredInvocation: vi.fn() } as never, workflowRuntime, {} as never, _HistoryStore(),
		)).rejects.toThrow("worker unavailable");

		expect(_calls).toEqual(expect.arrayContaining(["workers.start", "workflow", "history", "prisma", "telemetry", "console"]));
		expect(_calls.indexOf("history")).toBeLessThan(_calls.indexOf("telemetry"));
		expect(_calls.indexOf("prisma")).toBeLessThan(_calls.indexOf("telemetry"));
		expect(_calls.at(-1)).toBe("console");
	});

	it("closes inputs before draining workers and flushes telemetry after durable dependencies close", async function _ShutdownOrder()
	{
		const previousTerm = new Set(process.listeners("SIGTERM"));
		const previousInt = new Set(process.listeners("SIGINT"));
		const exit = vi.spyOn(process, "exit").mockImplementation(function _Exit() { _calls.push("exit"); return undefined as never; });
		const prisma = { $disconnect: async function _Disconnect() { _calls.push("prisma"); } } as unknown as PrismaClient;

		await _StartProcessLifecycle(
			_App(_Server("public")),
			_App(_Server("internal")),
			prisma,
		{ publicPort: 8080, internalPort: 8081 } as OpenCraneProcessConfig,
		function _UnbindConsole() { _calls.push("console"); },
			{ recoverExpiredInvocation: vi.fn() } as never,
			{} as IWorkflowWorkerRuntime,
			{} as never,
			_HistoryStore(),
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

		await _StartProcessLifecycle(_App(_Server("public")), _App(_Server("internal")), prisma, { publicPort: 8080, internalPort: 8081 } as OpenCraneProcessConfig, function _Unbind()
 { _calls.push("console"); }, { recoverExpiredInvocation: vi.fn() } as never, {} as IWorkflowWorkerRuntime, {} as never, _HistoryStore());
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
});
