import "./instrument.js";

import * as k8s from "@kubernetes/client-node";
import { ___BindConsole, ___ShutdownTelemetry } from "@opencrane/observability";

import { _ReadConfig } from "./config.js";
import { _log } from "./log.js";
import { _CreateServer } from "./server.js";

/** Start the private memory gateway and drain it before telemetry shuts down. */
function _Main(): void
{
	const unbindConsole = ___BindConsole(_log);
	const config = _ReadConfig();
	const kubeConfig = new k8s.KubeConfig();
	kubeConfig.loadFromDefault();
	const server = _CreateServer(config, kubeConfig.makeApiClient(k8s.AuthenticationV1Api));
	server.listen(config.port, function _listening()
	{
		_log.info({ port: config.port }, "memory gateway listening");
	});
	for (const signal of ["SIGTERM", "SIGINT"] as const)
	{
		process.once(signal, function _shutdown()
		{
			server.close(function _closed()
			{
				unbindConsole();
				void ___ShutdownTelemetry().finally(function _exit() { process.exit(0); });
			});
		});
	}
}

_Main();
