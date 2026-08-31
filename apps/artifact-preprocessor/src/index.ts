import "./instrument";

import { mkdir, readFile } from "node:fs/promises";

import { ___BindConsole, ___ShutdownTelemetry } from "@opencrane/backend/observability";
import { _CreateArtifactPreprocessorRemote, _CreatePdfTextExtractor, __ProcessArtifactPreprocessorJob } from "@opencrane/backend/artifacts/preprocessor";

import { _ReadConfig } from "./config";
import { _log as log } from "./log";

/** Start the one-shot worker, process its controller assignment, and flush telemetry on exit. */
async function _Main(): Promise<void>
{
	const unbindConsole = ___BindConsole(log);
	const shutdown = new AbortController();
	try
	{
		function _Shutdown(signal: string): void
		{
			if (shutdown.signal.aborted) return;
			log.info({ signal }, "artifact preprocessor shutting down");
			shutdown.abort(signal);
		}
		process.once("SIGTERM", function _sigterm() { _Shutdown("SIGTERM"); });
		process.once("SIGINT", function _sigint() { _Shutdown("SIGINT"); });
		// 1. Validate every mounted path and resource ceiling before reading the Job assignment.
		const config = _ReadConfig();
		await mkdir(config.scratchDirectory, { recursive: true, mode: 0o700 });
		const bootstrapReference = (await readFile(config.bootstrapReferencePath, "utf8")).trim();
		if (!bootstrapReference)
		{
			throw new Error("artifact preprocessor bootstrap reference is empty");
		}
		// 2. Exchange the mounted reference through the projected-token authority.
		const remote = _CreateArtifactPreprocessorRemote(config);
		const claim = await remote.bootstrap(bootstrapReference, shutdown.signal);
		// 3. Process this assignment once; the durable workflow owns retry and exact Job cleanup.
		const extractor = _CreatePdfTextExtractor();
		log.info({ jobId: claim.lease.jobId, attempt: claim.lease.attempt, maximumSourceBytes: config.maximumSourceBytes, maximumOutputBytes: config.maximumOutputBytes }, "artifact preprocessor started");
		await __ProcessArtifactPreprocessorJob({ remote, extractor, scratchDirectory: config.scratchDirectory, maximumSourceBytes: config.maximumSourceBytes, maximumOutputBytes: config.maximumOutputBytes, conversionTimeoutMilliseconds: config.conversionTimeoutMilliseconds, logger: log }, claim, shutdown.signal);
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
