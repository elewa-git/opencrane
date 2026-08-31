import "../instrument";

import { __CreateWarmAgentRunWorkflowHandler, __CreateHttpWarmAgentRunWorkflowControllerAuthority } from "@opencrane/backend/agents/execution/runs/controller";
import { AgentRunTaskDeclaration } from "@opencrane/backend/agents/execution/runs/workflows/contract";
import { __CreateLocalProcessWarmRuntimeStore } from "@opencrane/backend/agents/runtime/controller";
import { ___BindConsole, ___ShutdownTelemetry } from "@opencrane/backend/observability";
import type { IWorkflowWorkerRuntime } from "@opencrane/backend/server/infra/workflows/contract";
import { __CreateWorkflowGuard, __CreateWorkflowTaskQueueAuthority } from "@opencrane/backend/server/infra/workflows/guard";
import { _CreateAbsurdWorkflowEngine } from "@opencrane/backend/server/infra/workflows/infra_absurd";

import { _ReadDevelopmentConfig } from "./config";
import { _log as log } from "../log";

/** Rewrite the validated synthetic Service origin to the loopback Tier 2 listener. */
function _LoopbackFetch(loopbackOrigin: string): typeof fetch
{
	return async function _Fetch(input, init): Promise<Response>
	{
		const source = new URL(input instanceof Request ? input.url : input);
		const target = new URL(`${source.pathname}${source.search}`, loopbackOrigin);
		return await fetch(target, init);
	};
}

/** Start the development-only warm-runtime workflow and flush telemetry on shutdown. */
async function _Main(): Promise<void>
{
	const unbindConsole = ___BindConsole(log);
	const shutdown = new AbortController();
	let workflowRuntime: IWorkflowWorkerRuntime | null = null;
	try
	{
		const config = _ReadDevelopmentConfig();
		const syntheticServerOrigin = `http://${config.serverServiceName}.${config.serverNamespace}.svc.cluster.local`;
		const authority = __CreateHttpWarmAgentRunWorkflowControllerAuthority({
			openCraneInternalUrl: syntheticServerOrigin,
			serverServiceName: config.serverServiceName,
			serverNamespace: config.serverNamespace,
			tokenPath: config.controllerTokenPath,
			requestTimeoutMilliseconds: config.requestTimeoutMilliseconds,
			shutdownSignal: shutdown.signal,
			fetch: _LoopbackFetch(config.openCraneInternalUrl)
		});
		const localRuntimes = __CreateLocalProcessWarmRuntimeStore({
			runtimeApplicationDirectory: config.runtimeApplicationDirectory,
			pythonExecutable: config.pythonExecutable,
			runtimeStreamUrl: config.runtimeStreamUrl,
			litellmBaseUrl: config.litellmBaseUrl,
			runtimeLaunchSecretPath: config.runtimeLaunchSecretPath,
			modelStrategy: config.modelStrategy,
			profiles: config.warmRuntimeProfiles,
			shutdownSignal: shutdown.signal
		});
		const queueAuthority = __CreateWorkflowTaskQueueAuthority([{ taskName: AgentRunTaskDeclaration.taskName, queue: "agent-runs" }]);
		const runtime = _CreateAbsurdWorkflowEngine({ databasePoolSize: config.workflowDatabasePoolSize, databaseUrl: config.databaseUrl, log, pollIntervalMs: config.workflowPollIntervalMilliseconds, queueAuthority, workerConcurrency: config.workflowWorkerConcurrency });
		workflowRuntime = runtime;
		const execution = __CreateWorkflowGuard({ execution: runtime, log, queueAuthority, siloId: config.siloId });
		execution.register(__CreateWarmAgentRunWorkflowHandler({ authority, kubernetes: localRuntimes, profiles: config.warmRuntimeProfiles, pollIntervalMilliseconds: config.pollIntervalMilliseconds }));

		function _Shutdown(signal: string): void
		{
			if (!shutdown.signal.aborted)
			{
				log.info({ signal }, "local Agent controller shutting down");
				shutdown.abort(signal);
			}
		}
		process.once("SIGTERM", function _Sigterm() { _Shutdown("SIGTERM"); });
		process.once("SIGINT", function _Sigint() { _Shutdown("SIGINT"); });
		await runtime.startWorkers({ workerName: "local-agent-controller" });
		log.info({ profile: config.profile, workloadProfiles: Object.keys(config.warmRuntimeProfiles) }, "local Agent controller started");
		await new Promise<void>(function _Wait(resolve) { shutdown.signal.addEventListener("abort", function _Stopped() { resolve(); }, { once: true }); });
	}
	finally
	{
		shutdown.abort("local Agent controller stopped");
		if (workflowRuntime !== null)
		{
			try { await workflowRuntime.close(); }
			catch (err) { log.error({ err }, "local Agent controller workflow shutdown failed"); }
		}
		await ___ShutdownTelemetry();
		unbindConsole();
	}
}

void _Main().catch(function _StartupFailure(err)
{
	log.error({ err }, "local Agent controller stopped after a fatal failure");
	process.exitCode = 1;
});
