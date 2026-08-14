import "./instrument";

import { mkdir } from "node:fs/promises";

import { _CreateArtifactScannerRemote, _CreateClamAvScanner, __RunArtifactScanner } from "@opencrane/backend/artifacts/scanner";
import { ___BindConsole, ___ShutdownTelemetry } from "@opencrane/backend/observability";

import { _ReadConfig } from "./config";
import { _log as log } from "./log";

/** Compose and run the outbound-only malware scanner. */
async function _Main(): Promise<void>
{
	const unbindConsole = ___BindConsole(log);
	const shutdown = new AbortController();
	try
	{
		// 1. Validate the broker, read-only definitions, and bounded scratch configuration.
		const config = _ReadConfig();
		await mkdir(config.scratchDirectory, { recursive: true, mode: 0o700 });
		// 2. Compose only the projected-token remote and offline scanner.
		const remote = _CreateArtifactScannerRemote(config);
		const scanner = _CreateClamAvScanner(config.executablePath, config.databasePath, config.scannerVersion);
		// 3. Drain the abortable loop before flushing telemetry.
		function _Shutdown(signal: string): void
		{
			if (shutdown.signal.aborted) return;
			log.info({ signal }, "artifact scanner shutting down");
			shutdown.abort(signal);
		}
		process.once("SIGTERM", function _sigterm() { _Shutdown("SIGTERM"); });
		process.once("SIGINT", function _sigint() { _Shutdown("SIGINT"); });
		log.info({ maximumSourceBytes: config.maximumSourceBytes }, "artifact scanner started");
		await __RunArtifactScanner({ remote, scanner, scratchDirectory: config.scratchDirectory, maximumSourceBytes: config.maximumSourceBytes, scanTimeoutMilliseconds: config.scanTimeoutMilliseconds, pollIntervalMilliseconds: config.pollIntervalMilliseconds, logger: log }, shutdown.signal);
	}
	finally
	{
		await ___ShutdownTelemetry();
		unbindConsole();
	}
}

void _Main().catch(function _startupFailure(err)
{
	log.error({ err }, "artifact scanner stopped after a fatal failure");
	process.exitCode = 1;
});
