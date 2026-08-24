import type { Server } from "node:http";

import type { Express } from "express";

import type { RunCancellationRepository } from "@opencrane/backend/agents/execution/runs";
import { ___ShutdownTelemetry } from "@opencrane/backend/observability";

import { _log } from "../app/log";
import { _BeginProcessShutdown } from "../app/process-shutdown";
import { _StartRuntimeRepair } from "../app/runtime-repair";

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

/** Start the Tier 2 public API and optional Agent API on loopback, then bind their shutdown sequence. */
export function _StartDevelopmentLifecycle(publicApp: Express, internalApp: Express | null, prisma: DevelopmentPrismaClient, runtimeRepairRepository: RunCancellationRepository, publicPort: number, internalPort: number, unbindConsole: () => void): void
{
	const publicServer = publicApp.listen(publicPort, "127.0.0.1", function _Listening(): void
	{
		_log.info({ port: publicPort }, "Tier 2 OpenCrane API listening on loopback");
	});
	const internalServer = internalApp?.listen(internalPort, "127.0.0.1", function _InternalListening(): void
	{
		_log.info({ port: internalPort }, "Tier 2 OpenCrane Agent API listening on loopback");
	}) ?? null;
	const runtimeRepair = _StartRuntimeRepair(runtimeRepairRepository, true);
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
			runtimeRepair.stop();
			await _CloseServer(publicServer);

			if (internalServer)
			{
				await _CloseServer(internalServer);
			}

			// 2. Release the local database pool before telemetry flushes its final spans.
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
