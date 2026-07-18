import "./instrument.js";

import { ___BindConsole, ___ShutdownTelemetry } from "@opencrane/observability";

import { _ReadConfig } from "./config.js";
import { _log as log } from "./log.js";
import { _CreateServer, _PrepareArtifactStore } from "./server.js";

/** Start the private artifact-byte process and install bounded shutdown hooks. */
async function _Main(): Promise<void>
{
	const config = _ReadConfig();
	const store = await _PrepareArtifactStore(config);
	const server = _CreateServer(config, store);
	const unbindConsole = ___BindConsole(log);
	server.listen(config.port, function _onListen() { log.info({ port: config.port, artifactRoot: config.artifactRoot }, "artifact service listening"); });

	async function _Shutdown(signal: string): Promise<void>
	{
		log.info({ signal }, "artifact service shutting down");
		const hardExit = setTimeout(function _forceExit() { process.exit(1); }, 10_000);
		hardExit.unref();
		try
		{
			await new Promise<void>(function _close(resolve) { server.close(function _onClosed() { resolve(); }); });
			await ___ShutdownTelemetry();
		}
		catch (err)
		{
			log.error({ err }, "artifact service shutdown failed");
		}
		finally
		{
			unbindConsole();
			process.exit(0);
		}
	}

	process.on("SIGTERM", function _onSigterm() { void _Shutdown("SIGTERM"); });
	process.on("SIGINT", function _onSigint() { void _Shutdown("SIGINT"); });
}

void _Main().catch(function _onStartupFailure(err)
{
	_logStartupFailure(err);
	process.exitCode = 1;
});

/** Keep startup failures structured after telemetry bootstrap but before console binding. */
function _logStartupFailure(err: unknown): void
{
	log.error({ err }, "artifact service startup failed");
}
