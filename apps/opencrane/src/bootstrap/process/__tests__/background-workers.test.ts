import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import type { IWorkflowWorkerRuntime } from "@opencrane/backend/server/infra/workflows/contract";

import type { OpenCraneProcessConfig } from "../../configuration/config.types";

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
		const recoverExpiredInvocation = vi.fn().mockResolvedValue(false);
		const workers = await _StartBackgroundWorkers(
			{} as PrismaClient,
			{} as OpenCraneProcessConfig,
			{ recoverExpiredInvocation } as never,
			{ close, startWorkers } as IWorkflowWorkerRuntime,
			{ reconcileNext: vi.fn().mockResolvedValue(false) } as never,
		);

		expect(startWorkers).toHaveBeenCalledWith({ workerName: "opencrane-control-plane" });
		await vi.advanceTimersByTimeAsync(1_000);
		expect(recoverExpiredInvocation).toHaveBeenCalledOnce();
		await workers.stop();
		expect(close).toHaveBeenCalledOnce();
		vi.useRealTimers();
	});
});
