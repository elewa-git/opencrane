import type { Server } from "node:http";

import type { PrismaClient } from "@prisma/client";
import type { Express } from "express";

import { ___ShutdownTelemetry } from "@opencrane/backend/observability";
import type { IWorkflowWorkerRuntime } from "@opencrane/backend/server/infra/workflows/contract";
import type { McpRuntimeAuthority } from "@opencrane/backend/server/gateways/mcp";
import type { ProviderEffectCommandExecutor } from "@opencrane/backend/server/gateways/providers";

import { _StartBackgroundWorkers } from "./background-workers";
import type { OpenCraneBackgroundWorkers } from "./background-workers.types";
import type { ConversationComputerActivationWorker } from "@opencrane/backend/server/conversations";
import type { OpenCraneProcessConfig } from "../configuration/config.types";
import type { OpenCraneHistoryStoreComposition } from "@opencrane/backend/server/infra/history-store";
import type { OpenCraneHttpServers, OpenCraneStartupRecovery, OpenCraneStartupWorkerFactory } from "./lifecycle.types";
import { _log } from "./log";
import { _BeginProcessShutdown } from "./process-shutdown";

/** Close an HTTP server after it has stopped accepting new connections. */
function _closeServer(server: Server): Promise<void>
{
	return new Promise<void>(function _close(resolve)
	{
		server.close(function _closed() { resolve(); });
	});
}

/** Wait for every parallel cleanup before reporting the first failure. */
async function _settleCleanup(operations: readonly Promise<unknown>[]): Promise<void>
{
	const results = await Promise.allSettled(operations);
	const failed = results.find(function _Failed(result) { return "reason" in result; });
	if (failed && "reason" in failed)
		throw failed.reason;
}

/** Run one shutdown stage and keep later cleanup stages available after a failure. */
async function _runCleanupStage(stage: string, operation: () => Promise<void>): Promise<boolean>
{
	try
	{
		await operation();
		return true;
	}
	catch (error)
	{
		_log.error({ err: error, stage }, "control plane cleanup stage failed");
		return false;
	}
}

/** Bind the public and workload-facing apps to distinct sockets. */
function _startHttpServers(publicApp: Express, internalApp: Express, config: OpenCraneProcessConfig): OpenCraneHttpServers
{
	_log.info({ port: config.publicPort }, "starting opencrane control plane");
	const publicServer = publicApp.listen(config.publicPort, function _onPublicListen()
	{
		_log.info({ port: config.publicPort }, "control plane listening");
	});
	const internalServer = internalApp.listen(config.internalPort, function _onInternalListen()
	{
		_log.info({ internalPort: config.internalPort }, "control plane internal API listening");
	});
	return { internal: internalServer, public: publicServer };
}

/** Close dependencies created before listeners exist after composition or worker startup fails. */
export async function _CloseFailedProcessStartup(prisma: PrismaClient, workflowRuntime: IWorkflowWorkerRuntime | null, historyStore: OpenCraneHistoryStoreComposition, unbindConsole: () => void, conversationComputerActivations: ConversationComputerActivationWorker = { stop: async function _NoActivationWorker(): Promise<void> {} }): Promise<void>
{
	const hardExit = setTimeout(function _ForceStartupExit() { process.exit(1); }, 10_000);
	hardExit.unref();
	try
	{
		await _runCleanupStage("startup_dependencies", async function _CloseStartupDependencies()
		{
			const operations = [conversationComputerActivations.stop(), historyStore.close(), prisma.$disconnect()];
			if (workflowRuntime !== null)
				operations.push(workflowRuntime.close());
			await _settleCleanup(operations);
		});
		await _runCleanupStage("startup_telemetry", ___ShutdownTelemetry);
		unbindConsole();
	}
	finally
	{
		clearTimeout(hardExit);
	}
}

/** Give pre-lifecycle assembly one cleanup owner without making lifecycle failures close twice. */
export async function _OwnProcessStartupComposition<T>(compose: () => Promise<T>, cleanup: () => Promise<void>): Promise<T>
{
	try
	{
		return await compose();
	}
	catch (error)
	{
		await cleanup();
		throw error;
	}
}

/**
 * Start both listeners and background workers, then bind their coordinated shutdown.
 *
 * Workload routes stay on a separate socket throughout the lifecycle; shutdown stops producers
 * before closing listeners and database state, then flushes telemetry as the final I/O boundary.
 */
export async function _StartProcessLifecycle(publicApp: Express, internalApp: Express, prisma: PrismaClient, config: OpenCraneProcessConfig, unbindConsole: () => void, mcpRuntime: McpRuntimeAuthority, workflowRuntime: IWorkflowWorkerRuntime, providerEffects: ProviderEffectCommandExecutor, historyStore: OpenCraneHistoryStoreComposition, startup: OpenCraneStartupRecovery, startupWorkers: OpenCraneStartupWorkerFactory): Promise<void>
{
	// 1. Repair schedule heads after task registration and before a worker can claim them.
	let backgroundWorkers: OpenCraneBackgroundWorkers;
	let conversationComputerActivations: ConversationComputerActivationWorker = { stop: async function _NoActivationWorker(): Promise<void> {} };
	try
	{
		await startup.repairAllActiveSchedules();
		conversationComputerActivations = await startupWorkers.start();
		backgroundWorkers = await _StartBackgroundWorkers(prisma, config, mcpRuntime, workflowRuntime, providerEffects);
	}
	catch (error)
	{
		await _CloseFailedProcessStartup(prisma, workflowRuntime, historyStore, unbindConsole, conversationComputerActivations);
		throw error;
	}

	// 2. Bind both listeners after worker startup succeeds, so a broken worker cannot leave a partial server running.
	const servers = _startHttpServers(publicApp, internalApp, config);

	// 3. Register one idempotent shutdown path so concurrent signals cannot drain dependencies twice.
	let shutdownStarted = false;
	async function _shutdown(signal: string): Promise<void>
	{
		if (shutdownStarted)
			return;
		shutdownStarted = true;
		_log.info({ signal }, "shutting down control plane");
		const hardExit = setTimeout(function _forceExit() { process.exit(1); }, 10_000);
		hardExit.unref();

		let clean = await _runCleanupStage("stop_inputs", async function _StopInputs()
		{
			await _settleCleanup([
				Promise.resolve().then(_BeginProcessShutdown),
			]);
		});
		clean = await _runCleanupStage("drain_workers", async function _DrainWorkers() { await _settleCleanup([backgroundWorkers.stop(), conversationComputerActivations.stop()]); })
 && clean;
		clean = await _runCleanupStage("close_listeners", async function _CloseListeners() { await _settleCleanup([_closeServer(servers.public), _closeServer(servers.internal)]); }) && clean;
		clean = await _runCleanupStage("disconnect_history_store", historyStore.close) && clean;
		clean = await _runCleanupStage("disconnect_database", async function _DisconnectDatabase() { await prisma.$disconnect(); }) && clean;
		clean = await _runCleanupStage("flush_telemetry", ___ShutdownTelemetry) && clean;
		clearTimeout(hardExit);
		unbindConsole();
		process.exit(clean ? 0 : 1);
	}

	process.on("SIGTERM", function _onSigterm() { void _shutdown("SIGTERM"); });
	process.on("SIGINT", function _onSigint() { void _shutdown("SIGINT"); });
}
