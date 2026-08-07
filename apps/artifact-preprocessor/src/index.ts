import "./instrument.js";

import { mkdir } from "node:fs/promises";

import { ___BindConsole, ___ShutdownTelemetry } from "@opencrane/backend/observability";
import { _CreateArtifactPreprocessorRemote, _CreatePdfTextExtractor, __RunArtifactPreprocessor } from "@opencrane/backend/artifacts/preprocessor";

import { _ReadConfig } from "./config.js";
import { _log as log } from "./log.js";

/** Start the outbound-only worker and drain its poll loop and telemetry on shutdown. */
async function _Main(): Promise<void>
{
	const unbindConsole = ___BindConsole(log);
	const shutdown = new AbortController();
	try
	{
		// 1. Validate every mounted path and resource ceiling before claiming any durable work.
		const config = _ReadConfig();
		await mkdir(config.scratchDirectory, { recursive: true, mode: 0o700 });
		// 2. Compose only the projected-token authority adapter and shell-free converter.
		const remote = _CreateArtifactPreprocessorRemote(config);
		const extractor = _CreatePdfTextExtractor();
		// 3. Turn Kubernetes termination signals into one abortable bounded poll loop.
		function _Shutdown(signal: string): void
		{
			if (shutdown.signal.aborted) return;
			log.info({ signal }, "artifact preprocessor shutting down");
			shutdown.abort(signal);
		}
		process.once("SIGTERM", function _sigterm() { _Shutdown("SIGTERM"); });
		process.once("SIGINT", function _sigint() { _Shutdown("SIGINT"); });
		log.info({ maximumSourceBytes: config.maximumSourceBytes, maximumOutputBytes: config.maximumOutputBytes }, "artifact preprocessor started");
		await __RunArtifactPreprocessor({ remote, extractor, scratchDirectory: config.scratchDirectory, maximumSourceBytes: config.maximumSourceBytes, maximumOutputBytes: config.maximumOutputBytes, conversionTimeoutMilliseconds: config.conversionTimeoutMilliseconds, pollIntervalMilliseconds: config.pollIntervalMilliseconds, logger: log }, shutdown.signal);
	}
	finally
	{
		await ___ShutdownTelemetry();
		unbindConsole();
	}
}

void _Main().catch(function _startupFailure(err)
{
	log.error({ err }, "artifact preprocessor stopped after a fatal failure");
	process.exitCode = 1;
});
