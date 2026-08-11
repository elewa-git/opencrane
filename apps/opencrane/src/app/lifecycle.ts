import type { Server } from "node:http";

import type * as k8s from "@kubernetes/client-node";
import type { PrismaClient } from "@prisma/client";
import type { Express } from "express";

import type { ManagedRunAdmissionPort } from "@opencrane/backend/server/agents/agent-services";
import type { ChannelTargetRouteReconciler } from "@opencrane/backend/server/agents/channel-targets";
import { ___ShutdownTelemetry } from "@opencrane/backend/observability";

import { _StartBackgroundWorkers } from "./background-workers.js";
import type { OpenCraneProcessConfig } from "./config.types.js";
import type { OpenCraneHttpServers } from "./lifecycle.types.js";
import { _log } from "./log.js";
import { _BeginProcessShutdown } from "./process-shutdown.js";

/** Close an HTTP server after it has stopped accepting new connections. */
function _closeServer(server: Server): Promise<void>
{
	return new Promise<void>(function _close(resolve)
	{
		server.close(function _closed() { resolve(); });
	});
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

/**
 * Start both listeners and background workers, then bind their coordinated shutdown.
 *
 * Workload routes stay on a separate socket throughout the lifecycle; shutdown stops producers
 * before closing listeners and database state, then flushes telemetry as the final I/O boundary.
 */
export function _StartProcessLifecycle(publicApp: Express, internalApp: Express, prisma: PrismaClient, batchApi: k8s.BatchV1Api, managedRunAdmission: ManagedRunAdmissionPort, config: OpenCraneProcessConfig, channelTargetRoutes: ChannelTargetRouteReconciler, unbindConsole: () => void): void
{
	// 1. Bind both transport surfaces before starting the loops that serve or repair their work.
	const servers = _startHttpServers(publicApp, internalApp, config);

	// 2. Start process-owned workers only after their public and internal control surfaces exist.
	const backgroundWorkers = _StartBackgroundWorkers(prisma, batchApi, managedRunAdmission, config);

	// 3. Register one idempotent shutdown path so concurrent signals cannot drain dependencies twice.
	let shutdownStarted = false;
	async function _shutdown(signal: string): Promise<void>
	{
		if (shutdownStarted) return;
		shutdownStarted = true;
		_log.info({ signal }, "shutting down control plane");
		const hardExit = setTimeout(function _forceExit() { process.exit(1); }, 10_000);
		hardExit.unref();

		try
		{
			// 1. End long-lived streams before the ten-second hard-exit and telemetry-flush fence.
			_BeginProcessShutdown();
			// 2. Stop producers and drain active cleanup before its Kubernetes and Prisma ports close.
			await Promise.all([backgroundWorkers.stop(), channelTargetRoutes.stop()]);
			// 3. Stop both listeners together so public and workload traffic drain as one process.
			await Promise.all([_closeServer(servers.public), _closeServer(servers.internal)]);
			// 4. Release durable state only after requests and workers can no longer use it.
			await prisma.$disconnect();
			// 5. Flush buffered spans after all instrumented I/O has completed.
			await ___ShutdownTelemetry();
		}
		catch (error)
		{
			_log.error({ err: error }, "error during graceful shutdown");
		}
		finally
		{
			// 6. Restore console last so no shutdown log can escape the structured logger.
			unbindConsole();
			process.exit(0);
		}
	}

	process.on("SIGTERM", function _onSigterm() { void _shutdown("SIGTERM"); });
	process.on("SIGINT", function _onSigint() { void _shutdown("SIGINT"); });
}
