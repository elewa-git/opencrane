import "./instrument";

import { ___BindConsole, ___ShutdownTelemetry } from "@opencrane/backend/observability";

import { _ReadConfig } from "./config";
import { _RunControllerRuntime } from "./controller-runtime";
import { _log as log } from "./log";

/** Installs both Kubernetes termination signals on the one process shutdown controller. */
function _InstallShutdown(shutdown: AbortController): void
{
	/** Aborts each outbound loop after recording which process signal started the drain. */
	function _Shutdown(signal: string): void
	{
		if (shutdown.signal.aborted)
			return;
		log.info({ signal }, "agent controller shutting down");
		shutdown.abort(signal);
	}
	process.once("SIGTERM", function _Sigterm() { _Shutdown("SIGTERM"); });
	process.once("SIGINT", function _Sigint() { _Shutdown("SIGINT"); });
}

/** Start the outbound-only controller and drain its loop and telemetry on shutdown. */
async function _Main(): Promise<void>
{
	const unbindConsole = ___BindConsole(log);
	const shutdown = new AbortController();
	try
	{
		// 1. Validate fixed deployment configuration before any controller reads mutable desired state.
		const config = _ReadConfig();

		// 2. Convert both Kubernetes termination signals into the single loop-drain signal.
		_InstallShutdown(shutdown);

		// 3. Compose and run the three least-privilege controller loops until shutdown.
		await _RunControllerRuntime(config, shutdown.signal);
	}
	finally
	{
		await ___ShutdownTelemetry();
		unbindConsole();
	}
}

void _Main().catch(function _startupFailure(err)
{
	log.error({ err }, "agent controller stopped after a fatal failure");
	process.exitCode = 1;
});
