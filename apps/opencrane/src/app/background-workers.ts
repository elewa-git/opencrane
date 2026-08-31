import type * as k8s from "@kubernetes/client-node";
import type { PrismaClient } from "@prisma/client";

import type { ExternalActionWorker } from "@opencrane/backend/agents/execution/protocol";
import { __CreateRuntimeWorkloadCleanupUseCase, type RunCancellationRepository } from "@opencrane/backend/agents/execution/runs";
import { __CreateKubernetesRuntimeWorkloadCleanupStore } from "@opencrane/backend/agents/runtime/cleanup";
import type { ManagedRunAdmissionPort } from "@opencrane/backend/server/agents/agent-services";
import type { McpRuntimeAuthority } from "@opencrane/backend/server/gateways/mcp";
import { _CreateScheduleTicker, PrismaScheduleTickerUnitOfWork } from "@opencrane/backend/server/agents/scheduling";
import type { IWorkflowWorkerRuntime } from "@opencrane/backend/server/infra/workflows/contract";

import type { OpenCraneBackgroundWorkers } from "./background-workers.types";
import type { OpenCraneProcessConfig } from "./config.types";
import { _log } from "./log";
import { _StartRuntimeRepair } from "./runtime-repair";

/** Delay between database-fenced runtime workload cleanup claims. */
const _RUNTIME_CLEANUP_INTERVAL_MILLISECONDS = 5_000;

/** Hard deadline for one Kubernetes Job read or conditional deletion. */
const _RUNTIME_CLEANUP_REQUEST_TIMEOUT_MILLISECONDS = 5_000;

/** Delay between bounded durable external-action passes. */
const _EXTERNAL_ACTION_INTERVAL_MILLISECONDS = 1_000;

/** Delay between server-owned checks for a lost MCP invocation completion report. */
const _MCP_INVOCATION_RECOVERY_INTERVAL_MILLISECONDS = 1_000;

/**
 * Start all bounded workers that intentionally share the control-plane database and identity.
 *
 * The returned stop handle is the lifecycle boundary: every loop must be stopped before Prisma is
 * disconnected, and none may keep the Node process alive on its own.
 */
export async function _StartBackgroundWorkers(prisma: PrismaClient, batchApi: k8s.BatchV1Api, managedRunAdmission: ManagedRunAdmissionPort, runtimeRepairRepository: RunCancellationRepository, config: OpenCraneProcessConfig, externalActions: ExternalActionWorker, mcpRuntime: McpRuntimeAuthority, workflowRuntime: IWorkflowWorkerRuntime): Promise<OpenCraneBackgroundWorkers>
{
	// 1. Prepare optional schedule admission through the same capacity port used by run-now requests.
	const scheduleTicker = _CreateScheduleTicker(new PrismaScheduleTickerUnitOfWork(prisma), managedRunAdmission, _log);

	// 2. Bind physical cleanup to the same durable cancellation authority used by the public route.
	const runtimeCleanupShutdown = new AbortController();
	const runtimeCleanup = __CreateRuntimeWorkloadCleanupUseCase({
		repository: runtimeRepairRepository,
		store: __CreateKubernetesRuntimeWorkloadCleanupStore({
			batchApi,
			requestTimeoutMilliseconds: _RUNTIME_CLEANUP_REQUEST_TIMEOUT_MILLISECONDS,
			shutdownSignal: runtimeCleanupShutdown.signal,
		}),
	});

	// 3. Start the durable worker after application composition has registered every task handler.
	try
	{
		await workflowRuntime.startWorkers({ workerName: "opencrane-control-plane" });
	}
	catch (error)
	{
		runtimeCleanupShutdown.abort();
		try { await workflowRuntime.close(); }
		catch (closeError) { _log.error({ err: closeError }, "durable workflow cleanup after startup failure failed"); }
		throw error;
	}

	// 4. Start process-owned intervals only after the durable worker is ready.
	const schedulerHandle = config.schedulerEnabled
		? setInterval(function _tick() { void scheduleTicker.runOnce(new Date()).catch(function _onError(error: unknown) { _log.error({ err: error }, "managed-agent schedule tick failed"); }); }, config.schedulerIntervalMilliseconds)
		: null;
	schedulerHandle?.unref();

	// 5. Mark expired runs terminal in the database separately from physical Job cleanup, and fence both in Postgres.
	const runtimeRepair = _StartRuntimeRepair(runtimeRepairRepository);
	const runtimeCleanupHandle = setInterval(function _cleanup() { void runtimeCleanup.reconcileNext().catch(function _onError(error: unknown) { _log.error({ err: error }, "runtime workload cleanup failed"); }); }, _RUNTIME_CLEANUP_INTERVAL_MILLISECONDS);
	runtimeCleanupHandle.unref();

	// 6. Poll at most one durable action per pass; the worker itself prevents overlapping provider I/O.
	const externalActionHandle = setInterval(function _externalAction() { void externalActions.runOnce().catch(function _onError(error: unknown) { _log.error({ err: error }, "external action worker pass failed"); }); }, _EXTERNAL_ACTION_INTERVAL_MILLISECONDS);
	externalActionHandle.unref();
	const mcpRecoveryHandle = setInterval(function _recoverMcpInvocation() { void mcpRuntime.recoverExpiredInvocation().catch(function _onError(error: unknown) { _log.error({ err: error }, "MCP invocation recovery pass failed"); }); }, _MCP_INVOCATION_RECOVERY_INTERVAL_MILLISECONDS);
	mcpRecoveryHandle.unref();

	return {
		async stop(): Promise<void>
		{
			if (schedulerHandle !== null)
				clearInterval(schedulerHandle);
			clearInterval(externalActionHandle);
			clearInterval(mcpRecoveryHandle);
			runtimeRepair.stop();
			clearInterval(runtimeCleanupHandle);
			runtimeCleanupShutdown.abort();
			await Promise.all([runtimeCleanup.drain(), externalActions.drain(), workflowRuntime.close()]);
		},
	};
}
