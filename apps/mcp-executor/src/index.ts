import "./instrument";

import { __CreateMcpCompanionRemote, __CreateMcpCompanionServer, __ReadMcpCompanionIdentity, __RunMcpCompanion } from "@opencrane/backend/agents/runtime/mcp-executor/companion";
import { ___BindConsole, ___ShutdownTelemetry } from "@opencrane/backend/observability";

import { _ReadConfig } from "./config";
import { _log as log } from "./log";

/** Compose and run exactly one outbound MCP companion claim. */
async function _Main(): Promise<void>
{
	const unbindConsole = ___BindConsole(log);
	const shutdown = new AbortController();
	function _Shutdown(signal: string): void
	{
		if (shutdown.signal.aborted)
			return;
		log.info({ signal }, "MCP companion shutting down");
		shutdown.abort(signal);
	}
	process.once("SIGTERM", function _Sigterm() { _Shutdown("SIGTERM"); });
	process.once("SIGINT", function _Sigint() { _Shutdown("SIGINT"); });
	try
	{
		// 1. Freeze the mounted execution reference and immutable Pod UID for this one-shot process.
		const config = _ReadConfig();
		const identity = await __ReadMcpCompanionIdentity(config.referencePath, config.podUid);
		// 2. Compose only the fixed OpenCrane route and Pod-local MCP transport.
		const remote = __CreateMcpCompanionRemote({ openCraneExecutorUrl: config.openCraneExecutorUrl, tokenPath: config.tokenPath, requestTimeoutMilliseconds: config.openCraneTimeoutMilliseconds, maximumResponseBytes: config.commandByteLimit, maximumRequestBytes: config.reportByteLimit });
		const server = __CreateMcpCompanionServer({ serverUrl: config.serverUrl, requestTimeoutMilliseconds: config.serverTimeoutMilliseconds, maximumRequestBytes: config.commandByteLimit, maximumResponseBytes: config.resultByteLimit });
		// 3. Claim once, report once, and let the Job terminate.
		await __RunMcpCompanion({ remote, server, log }, identity, shutdown.signal);
	}
	finally
	{
		await ___ShutdownTelemetry();
		unbindConsole();
	}
}

void _Main().catch(function _Fatal(err)
{
	log.error({ err }, "MCP companion stopped after a fatal failure");
	process.exitCode = 1;
});
