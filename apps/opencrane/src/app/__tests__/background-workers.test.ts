import type * as k8s from "@kubernetes/client-node";
import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import type { ExternalActionWorker } from "@opencrane/backend/agents/execution/protocol";
import type { RunCancellationRepository } from "@opencrane/backend/agents/execution/runs";
import type { ManagedRunAdmissionPort } from "@opencrane/backend/server/agents/agent-services";
import type { DurableWorkerRuntime } from "@opencrane/backend/server/infra/workflows/contract";

import type { OpenCraneProcessConfig } from "../config.types";

const _cleanupDrain = vi.hoisted(function _CleanupDrain() { return vi.fn(async function _drain(): Promise<void> {}); });

vi.mock("@opencrane/backend/agents/execution/runs", function _Runs()
{
	return { __CreateRuntimeWorkloadCleanupUseCase: function _CreateCleanup() { return { drain: _cleanupDrain, reconcileNext: vi.fn() }; } };
});

vi.mock("@opencrane/backend/agents/runtime/cleanup", function _Cleanup()
{
	return { __CreateKubernetesRuntimeWorkloadCleanupStore: function _CreateStore() { return {}; } };
});

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
		const startWorkers = vi.fn(async function _StartWorkers() { return { workerId: "worker", workerName: "opencrane-control-plane", drain: vi.fn(), stop: vi.fn() }; });
		const close = vi.fn(async function _Close(): Promise<void> {});
		const externalDrain = vi.fn(async function _DrainExternal(): Promise<void> {});
		const workers = await _StartBackgroundWorkers(
			{} as PrismaClient,
			{} as k8s.BatchV1Api,
			{} as ManagedRunAdmissionPort,
			{ repairNextExpiredRunAtomically: vi.fn() } as unknown as RunCancellationRepository,
			{ schedulerEnabled: false, schedulerIntervalMilliseconds: 60_000 } as OpenCraneProcessConfig,
			{ drain: externalDrain, runOnce: vi.fn() } as unknown as ExternalActionWorker,
			{ close, startWorkers } as DurableWorkerRuntime,
		);

		expect(startWorkers).toHaveBeenCalledWith({ workerName: "opencrane-control-plane" });
		await workers.stop();
		expect(close).toHaveBeenCalledOnce();
		expect(_cleanupDrain).toHaveBeenCalledOnce();
		expect(externalDrain).toHaveBeenCalledOnce();
	});
});
