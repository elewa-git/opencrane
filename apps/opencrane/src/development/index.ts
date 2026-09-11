// OpenTelemetry must load before the current server dependencies it instruments.
import "../app/instrument";

import { ___BindConsole, ___ShutdownTelemetry } from "@opencrane/backend/observability";

import { _log } from "../app/log";
import { _CreateDevelopmentServerComposition } from "./composition";
import { _BindDevelopmentSignalCleanup } from "./cleanup";
import { _ReadDevelopmentConfig } from "./config";
import { _StartDevelopmentServer } from "./lifecycle";

/** Compose the selected Tier 2 process and retain one idempotent signal cleanup path. */
async function _Main(): Promise<void>
{
	const unbindConsole = ___BindConsole(_log);
	const config = _ReadDevelopmentConfig();
	const composition = await _CreateDevelopmentServerComposition(config);
	const handle = await _StartDevelopmentServer(composition, config.publicPort);
	_BindDevelopmentSignalCleanup(handle, ___ShutdownTelemetry, unbindConsole, process, _log);
}

void _Main().catch(function _Fatal(error: unknown): void
{
	_log.fatal({ err: error }, "Tier 2 product server failed");
	process.exitCode = 1;
});
