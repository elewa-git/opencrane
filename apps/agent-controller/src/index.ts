import "./instrument.js";

import * as k8s from "@kubernetes/client-node";

import { __CreateHttpAgentControllerAuthority, __CreateKubernetesAgentControllerStore, __RunAgentController } from "@opencrane/backend/agents/runtime/controller";
import { __CreateHttpSkillWorkloadControllerAuthority, __RunSkillWorkloadController } from "@opencrane/backend/agents/skills/controller";
import { ___BindConsole, ___ShutdownTelemetry } from "@opencrane/observability";

import { _ReadConfig } from "./config.js";
import { _log as log } from "./log.js";

/** Start the outbound-only controller and drain its loop and telemetry on shutdown. */
async function _Main(): Promise<void>
{
	const unbindConsole = ___BindConsole(log);
	const shutdown = new AbortController();
	try
	{
		// 1. Validate the fixed silo/profile contract before loading any mutable desired state.
		const config = _ReadConfig();

		// 2. Compose only the projected-token authority and least-privilege namespaced clients.
		const kubeConfig = new k8s.KubeConfig();
		kubeConfig.loadFromCluster();
		const authority = __CreateHttpAgentControllerAuthority({ openCraneInternalUrl: config.openCraneInternalUrl, tokenPath: config.controllerTokenPath, requestTimeoutMilliseconds: config.requestTimeoutMilliseconds });
		const skillWorkloadAuthority = __CreateHttpSkillWorkloadControllerAuthority({ openCraneInternalUrl: config.openCraneInternalUrl, tokenPath: config.controllerTokenPath, requestTimeoutMilliseconds: config.requestTimeoutMilliseconds });
		const kubernetes = __CreateKubernetesAgentControllerStore({ batchApi: kubeConfig.makeApiClient(k8s.BatchV1Api), coreApi: kubeConfig.makeApiClient(k8s.CoreV1Api), requestTimeoutMilliseconds: config.requestTimeoutMilliseconds, shutdownSignal: shutdown.signal });

		// 3. Convert both Kubernetes termination signals into one abortable poll loop.
		function _Shutdown(signal: string): void
		{
			if (shutdown.signal.aborted) return;
			log.info({ signal }, "agent controller shutting down");
			shutdown.abort(signal);
		}
		process.once("SIGTERM", function _sigterm() { _Shutdown("SIGTERM"); });
		process.once("SIGINT", function _sigint() { _Shutdown("SIGINT"); });
		log.info({ runtimeNamespace: config.runtimeNamespace, profiles: Object.keys(config.profiles) }, "agent controller started");
		await Promise.all([
			__RunAgentController({ authority, kubernetes, profiles: config.profiles, runtimeNamespace: config.runtimeNamespace, pollIntervalMilliseconds: config.pollIntervalMilliseconds, outboxPruneIntervalMilliseconds: config.outboxPruneIntervalMilliseconds, log }, shutdown.signal),
			__RunSkillWorkloadController({ authority: skillWorkloadAuthority, kubernetes, profiles: config.skillWorkloadProfiles, pollIntervalMilliseconds: config.pollIntervalMilliseconds, log }, shutdown.signal),
		]);
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
