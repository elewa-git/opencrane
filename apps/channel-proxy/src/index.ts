import "./instrument";

import { ___BindConsole, ___ShutdownTelemetry } from "@opencrane/backend/observability";

import { _ReadConfig } from "./config";
import { _log as log } from "./log";
import { _CreateServer } from "./server";

/** Start the channel-proxy process and install bounded shutdown hooks. */
function _Main(): void
{
	// 1. Validate all authority, origin, and transport bounds before opening a listener.
	const config = _ReadConfig();
	const server = _CreateServer(config);
	const unbindConsole = ___BindConsole(log);
	server.listen(config.port, function _onListen() { log.info({ port: config.port }, "channel proxy listening"); });

	// 2. Drain requests and telemetry together so termination cannot discard correlated evidence.
	async function _shutdown(signal: string): Promise<void>
	{
		log.info({ signal }, "channel proxy shutting down");
		const hardExit = setTimeout(function _forceExit() { process.exit(1); }, 10_000);
		hardExit.unref();
		try
		{
			// 1. Stop accepting new work before flushing spans for the completed request set.
			await new Promise<void>(function _close(resolve) { server.close(function _onClosed() { resolve(); }); });
			// 2. Persist buffered trace evidence before the process exits.
			await ___ShutdownTelemetry();
		}
		catch (err)
		{
			log.error({ err }, "channel proxy shutdown failed");
		}
		finally
		{
			// 3. Restore process globals last so shutdown diagnostics stay structured.
			unbindConsole();
			process.exit(0);
		}
	}
	// 3. Bind both Kubernetes termination paths to the same bounded lifecycle.
	process.on("SIGTERM", function _onSigterm() { void _shutdown("SIGTERM"); });
	process.on("SIGINT", function _onSigint() { void _shutdown("SIGINT"); });
}

_Main();
