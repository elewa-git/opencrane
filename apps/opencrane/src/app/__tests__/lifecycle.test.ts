import type { Server } from "node:http";

import type * as k8s from "@kubernetes/client-node";
import type { PrismaClient } from "@prisma/client";
import type { Express } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ExternalActionWorker } from "@opencrane/backend/agents/execution/protocol";
import type { ManagedRunAdmissionPort } from "@opencrane/backend/server/agents/agent-services";
import type { RunCancellationRepository } from "@opencrane/backend/agents/execution/runs";
import type { ChannelTargetRouteReconciler } from "@opencrane/backend/server/agents/channel-targets";
import type { SelfConversationSocketServer } from "@opencrane/backend/server/conversations";

import type { OpenCraneProcessConfig } from "../config.types";

/** Ordered lifecycle calls shared by hoisted dependency mocks and assertions. */
const _calls = vi.hoisted(function _Calls() { return [] as string[]; });

vi.mock("@opencrane/backend/observability", function _Observability()
{
	return { ___ShutdownTelemetry: async function _ShutdownTelemetry() { _calls.push("telemetry"); } };
});

vi.mock("../background-workers", function _BackgroundWorkers()
{
	return { _StartBackgroundWorkers: function _StartBackgroundWorkers() { return { stop: async function _StopWorkers() { _calls.push("workers"); } }; } };
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

describe("OpenCrane process lifecycle", function _LifecycleSuite()
{
	it("aborts Obot before draining workers and flushes telemetry after durable dependencies close", async function _ShutdownOrder()
	{
		const previousTerm = new Set(process.listeners("SIGTERM"));
		const previousInt = new Set(process.listeners("SIGINT"));
		const exit = vi.spyOn(process, "exit").mockImplementation(function _Exit() { _calls.push("exit"); return undefined as never; });
		const prisma = { $disconnect: async function _Disconnect() { _calls.push("prisma"); } } as unknown as PrismaClient;
		const channelTargets = { stop: async function _StopRoutes() { _calls.push("routes"); } } as unknown as ChannelTargetRouteReconciler;

		_StartProcessLifecycle(
			_App(_Server("public")),
			_App(_Server("internal")),
			prisma,
			{} as k8s.BatchV1Api,
			{} as ManagedRunAdmissionPort,
			{} as RunCancellationRepository,
		{ publicPort: 8080, internalPort: 8081 } as OpenCraneProcessConfig,
		channelTargets,
		{ attach: function _Attach() { _calls.push("socket.attach"); }, close: function _CloseSockets() { _calls.push("sockets"); } } as SelfConversationSocketServer,
		function _UnbindConsole() { _calls.push("console"); },
			{} as ExternalActionWorker,
			function _StopObot() { _calls.push("obot"); },
		);

		const term = process.listeners("SIGTERM").find(function _New(listener) { return !previousTerm.has(listener); });
		const interrupt = process.listeners("SIGINT").find(function _New(listener) { return !previousInt.has(listener); });
		if (term === undefined || interrupt === undefined) throw new Error("lifecycle did not register process signal handlers");
		_registeredListeners.push({ signal: "SIGTERM", listener: term }, { signal: "SIGINT", listener: interrupt });
		expect(_calls).toContain("socket.attach");
		term("SIGTERM");

		await vi.waitFor(function _Exited() { expect(exit).toHaveBeenCalledWith(0); });
		expect(_calls.indexOf("streams")).toBeLessThan(_calls.indexOf("obot"));
		expect(_calls.indexOf("streams")).toBeLessThan(_calls.indexOf("sockets"));
		expect(_calls.indexOf("sockets")).toBeLessThan(_calls.indexOf("obot"));
		expect(_calls.indexOf("obot")).toBeLessThan(_calls.indexOf("workers"));
		expect(_calls.indexOf("workers")).toBeLessThan(_calls.indexOf("prisma"));
		expect(_calls.indexOf("prisma")).toBeLessThan(_calls.indexOf("telemetry"));
		expect(_calls.slice(-3)).toEqual(["telemetry", "console", "exit"]);
	});
});
