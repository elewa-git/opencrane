import "../instrument";

import { __CreateHttpAgentControllerAuthority, __CreateLocalProcessAgentControllerStore, __RunAgentController } from "@opencrane/backend/agents/runtime/controller";
import { ___BindConsole, ___ShutdownTelemetry } from "@opencrane/backend/observability";

import { _ReadDevelopmentConfig } from "./config";
import { _log as log } from "../log";

/** Start the development-only local runtime host and flush telemetry on shutdown. */
async function _Main(): Promise<void>
{
	const unbindConsole = ___BindConsole(log);
	const shutdown = new AbortController();

	try
	{
		// 1. Validate the explicit Agent profile and its separate controller/runtime identities.
		const config = _ReadDevelopmentConfig();

		// 2. Reuse HTTP authority while replacing the Kubernetes Job host with local processes.
		const authority = __CreateHttpAgentControllerAuthority({
			openCraneInternalUrl: config.openCraneInternalUrl,
			tokenPath: config.controllerTokenPath,
			requestTimeoutMilliseconds: config.requestTimeoutMilliseconds
		});
		const localWorkloads = __CreateLocalProcessAgentControllerStore({
			runtimeApplicationDirectory: config.runtimeApplicationDirectory,
			pythonExecutable: config.pythonExecutable,
			runtimeStreamUrl: config.runtimeStreamUrl,
			litellmBaseUrl: config.litellmBaseUrl,
			runtimeLaunchSecretPath: config.runtimeLaunchSecretPath,
			modelStrategy: config.modelStrategy,
			shutdownSignal: shutdown.signal
		});

		// 3. Stop claim polling and every attempt process from either interactive termination signal.
		function _Shutdown(signal: string): void
		{
			if (shutdown.signal.aborted)
			{
				return;
			}

			log.info({ signal }, "local Agent controller shutting down");
			shutdown.abort(signal);
		}
		process.once("SIGTERM", function _sigterm() { _Shutdown("SIGTERM"); });
		process.once("SIGINT", function _sigint() { _Shutdown("SIGINT"); });
		log.info({ profile: config.profile, workloadProfiles: Object.keys(config.profiles) }, "local Agent controller started");
		await __RunAgentController({
			authority,
			workloads: localWorkloads,
			profiles: config.profiles,
			pollIntervalMilliseconds: config.pollIntervalMilliseconds,
			outboxPruneIntervalMilliseconds: config.outboxPruneIntervalMilliseconds,
			log
		}, shutdown.signal);
	}
	finally
	{
		await ___ShutdownTelemetry();
		unbindConsole();
	}
}

void _Main().catch(function _startupFailure(err)
{
	log.error({ err }, "local Agent controller stopped after a fatal failure");
	process.exitCode = 1;
});
