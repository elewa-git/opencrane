import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import type { ExternalActionWorker } from "@opencrane/backend/agents/execution/protocol";
import type { ManagedRunAdmissionPort } from "@opencrane/backend/server/agents/agent-services";
import type { IWorkflowWorkerRuntime } from "@opencrane/backend/server/infra/workflows/contract";

import type { OpenCraneProcessConfig } from "../config.types";

vi.mock("@opencrane/backend/server/agents/scheduling", function _Scheduling()
{
	return {
		_CreateScheduleTicker: function _CreateTicker() { return { runOnce: vi.fn() }; },
		PrismaScheduleTickerUnitOfWork: class PrismaScheduleTickerUnitOfWork {},
	};
});

vi.mock("../log", function _Log()
{
	return { _log: { error: vi.fn() } };
});

import { _StartBackgroundWorkers } from "../background-workers";

describe("OpenCrane background workers", function _BackgroundWorkerSuite()
{
	it("starts and drains the shared durable workflow runtime", async function _DurableWorkerLifecycle()
	{
		vi.useFakeTimers();
		const startWorkers = vi.fn(async function _StartWorkers() { return { workerId: "worker", workerName: "opencrane-control-plane", drain: vi.fn(), stop: vi.fn() }; });
		const close = vi.fn(async function _Close(): Promise<void> {});
		const externalDrain = vi.fn(async function _DrainExternal(): Promise<void> {});
		const recoverExpiredInvocation = vi.fn().mockResolvedValue(false);
		const workers = await _StartBackgroundWorkers(
			{} as PrismaClient,
			{} as ManagedRunAdmissionPort,
			{ schedulerEnabled: false, schedulerIntervalMilliseconds: 60_000 } as OpenCraneProcessConfig,
			{ drain: externalDrain, runOnce: vi.fn().mockResolvedValue(false) } as unknown as ExternalActionWorker,
			{ recoverExpiredInvocation } as never,
			{ close, startWorkers } as IWorkflowWorkerRuntime,
		);

		expect(startWorkers).toHaveBeenCalledWith({ workerName: "opencrane-control-plane" });
		await vi.advanceTimersByTimeAsync(1_000);
		expect(recoverExpiredInvocation).toHaveBeenCalledOnce();
		await workers.stop();
		expect(close).toHaveBeenCalledOnce();
		expect(externalDrain).toHaveBeenCalledOnce();
		vi.useRealTimers();
	});
});
