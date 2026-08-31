import type { Server } from "node:http";

import type { Express } from "express";

import type { SelfConversationSocketServer } from "@opencrane/backend/server/conversations";
import type { IWorkflowWorkerRuntime } from "@opencrane/backend/server/infra/workflows/contract";
import { ___ShutdownTelemetry } from "@opencrane/backend/observability";

import { _log } from "../app/log";
import { _BeginProcessShutdown } from "../app/process-shutdown";

/** Prisma client shape returned by the app-owned database composition. */
type DevelopmentPrismaClient = ReturnType<typeof import("../infra/db/db").___CreatePrismaClient>;

/** Close the loopback HTTP listener after it stops accepting requests. */
function _CloseServer(server: Server): Promise<void>
{
	return new Promise<void>(function _Close(resolve)
	{
		server.close(function _Closed(): void
		{
			resolve();
		});
	});
}

/**
 * Starts the Tier 2 listeners on loopback and owns their coordinated shutdown.
 *
 * The conversation WebSocket server attaches to the public HTTP server so the live UI uses the same
 * listener and authentication composition for HTTP and socket traffic. Shutdown fences new work,
 * closes sockets and listeners, then releases PostgreSQL before telemetry flushes.
 *
 * Called by: `_Main` in `development/index.ts` after public and optional Agent apps are composed.
 * @param publicApp - Live browser API composition.
 * @param internalApp - Agent protocol composition, or null for core.
 * @param conversationSockets - Live conversation socket server attached to the public listener.
 * @param prisma - Database client disconnected during shutdown.
 * @param workflowRuntime - Durable task engine closed before the shared database client.
 * @param publicPort - Loopback port for UI HTTP and WebSocket traffic.
 * @param internalPort - Loopback port for Agent controller and runtime traffic.
 * @param unbindConsole - Restores console bindings after telemetry shutdown.
 */
export function _StartDevelopmentLifecycle(publicApp: Express, internalApp: Express | null, conversationSockets: SelfConversationSocketServer, prisma: DevelopmentPrismaClient, workflowRuntime: IWorkflowWorkerRuntime, publicPort: number, internalPort: number, unbindConsole: () => void): void
{
	const publicServer = publicApp.listen(publicPort, "127.0.0.1", function _Listening(): void
	{
		_log.info({ port: publicPort }, "Tier 2 OpenCrane API listening on loopback");
	});
	conversationSockets.attach(publicServer);
	const internalServer = internalApp?.listen(internalPort, "127.0.0.1", function _InternalListening(): void
	{
		_log.info({ port: internalPort }, "Tier 2 OpenCrane Agent API listening on loopback");
	}) ?? null;
	let shutdownStarted = false;

	async function _Shutdown(signal: string): Promise<void>
	{
		if (shutdownStarted)
		{
			return;
		}

		shutdownStarted = true;
		_log.info({ signal }, "Tier 2 OpenCrane API shutting down");
		const hardExit = setTimeout(function _ForceExit(): void
		{
			process.exit(1);
		}, 10_000);
		hardExit.unref();

		try
		{
			// 1. Fence long-lived request work before the listener and durable store are drained.
			_BeginProcessShutdown();
			conversationSockets.close();
			await _CloseServer(publicServer);

			if (internalServer)
			{
				await _CloseServer(internalServer);
			}

			// 2. Release the workflow pool before the product database and final telemetry spans.
			await workflowRuntime.close();
			await prisma.$disconnect();
			await ___ShutdownTelemetry();
		}
		catch (error)
		{
			_log.error({ err: error }, "Tier 2 OpenCrane shutdown failed");
		}
		finally
		{
			clearTimeout(hardExit);
			unbindConsole();
			process.exit(0);
		}
	}

	process.once("SIGTERM", function _Sigterm(): void
	{
		void _Shutdown("SIGTERM");
	});
	process.once("SIGINT", function _Sigint(): void
	{
		void _Shutdown("SIGINT");
	});
}
