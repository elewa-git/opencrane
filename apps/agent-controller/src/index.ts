import "./instrument";

import * as k8s from "@kubernetes/client-node";

import { __CreateHttpWarmAgentRunWorkflowControllerAuthority, __CreateWarmAgentRunWorkflowHandler } from "@opencrane/backend/agents/execution/runs/controller";
import { AgentRunTaskDeclaration } from "@opencrane/backend/agents/execution/runs/workflows/contract";
import { __CreateWarmRuntimeKubernetesStore } from "@opencrane/backend/agents/runtime/controller";
import { __CreateHttpMcpExecutorControllerAuthority, __CreateKubernetesMcpExecutorControllerStore, __RunMcpExecutorController } from "@opencrane/backend/agents/runtime/mcp-executor/controller";
import { __CreateHttpSkillAuthoringValidationControllerAuthority, __CreateKubernetesSkillAuthoringValidationStore, __CreateSkillAuthoringValidationHandler } from "@opencrane/backend/agents/skills/controller";
import { SkillAuthoringValidationTaskDeclaration } from "@opencrane/backend/agents/skills/workflows/contract";
import { __CreateArtifactPreprocessHandler, __CreateHttpArtifactPreprocessControllerAuthority } from "@opencrane/backend/artifacts/preprocessor/controller";
import { ArtifactPreprocessTaskDeclaration } from "@opencrane/backend/artifacts/preprocessor/workflows/contract";
import { __CreateKubernetesGovernedJobControllerStore } from "@opencrane/backend/agents/runtime/workloads/k8s-controller";
import { ___BindConsole, ___ShutdownTelemetry } from "@opencrane/backend/observability";
import type { IWorkflowWorkerRuntime } from "@opencrane/backend/server/infra/workflows/contract";
import { __CreateWorkflowGuard, __CreateWorkflowTaskQueueAuthority } from "@opencrane/backend/server/infra/workflows/guard";
import { _CreateAbsurdWorkflowEngine } from "@opencrane/backend/server/infra/workflows/infra_absurd";

import { _ReadConfig } from "./config";
import { _log as log } from "./log";

/** Start the outbound-only controller and drain its loop and telemetry on shutdown. */
async function _Main(): Promise<void>
{
	const unbindConsole = ___BindConsole(log);
	const shutdown = new AbortController();
	let workflowRuntime: IWorkflowWorkerRuntime | null = null;
	try
	{
		// 1. Validate the fixed silo/profile contract before loading any mutable desired state.
		const config = _ReadConfig();

		// 2. Compose only the projected-token authority and least-privilege namespaced clients.
		const kubeConfig = new k8s.KubeConfig();
		kubeConfig.loadFromCluster();
		const controllerAuthorityOptions = { openCraneInternalUrl: config.openCraneInternalUrl, serverServiceName: config.serverServiceName, serverNamespace: config.serverNamespace, tokenPath: config.controllerTokenPath, requestTimeoutMilliseconds: config.requestTimeoutMilliseconds, shutdownSignal: shutdown.signal };
		const agentRunAuthority = __CreateHttpWarmAgentRunWorkflowControllerAuthority(controllerAuthorityOptions);
		const skillAuthoringAuthority = __CreateHttpSkillAuthoringValidationControllerAuthority(controllerAuthorityOptions);
		const mcpExecutorAuthority = __CreateHttpMcpExecutorControllerAuthority({ openCraneInternalUrl: config.openCraneInternalUrl, tokenPath: config.controllerTokenPath, requestTimeoutMilliseconds: config.requestTimeoutMilliseconds });
		const artifactAuthority = config.artifactPreprocessorProfile === undefined ? null : __CreateHttpArtifactPreprocessControllerAuthority(controllerAuthorityOptions);
		const agentRunKubernetes = __CreateWarmRuntimeKubernetesStore({ appsApi: kubeConfig.makeApiClient(k8s.AppsV1Api), coreApi: kubeConfig.makeApiClient(k8s.CoreV1Api), requestTimeoutMilliseconds: config.requestTimeoutMilliseconds, shutdownSignal: shutdown.signal });
		const skillKubernetes = __CreateKubernetesSkillAuthoringValidationStore({ batchApi: kubeConfig.makeApiClient(k8s.BatchV1Api), coreApi: kubeConfig.makeApiClient(k8s.CoreV1Api), requestTimeoutMilliseconds: config.requestTimeoutMilliseconds, shutdownSignal: shutdown.signal });
		const mcpKubernetes = __CreateKubernetesMcpExecutorControllerStore({ batchApi: kubeConfig.makeApiClient(k8s.BatchV1Api), coreApi: kubeConfig.makeApiClient(k8s.CoreV1Api), requestTimeoutMilliseconds: config.requestTimeoutMilliseconds, shutdownSignal: shutdown.signal });
		const artifactKubernetes = config.artifactPreprocessorProfile === undefined ? null : __CreateKubernetesGovernedJobControllerStore({ batchApi: kubeConfig.makeApiClient(k8s.BatchV1Api), coreApi: kubeConfig.makeApiClient(k8s.CoreV1Api), requestTimeoutMilliseconds: config.requestTimeoutMilliseconds, shutdownSignal: shutdown.signal, workloadLabelKey: "opencrane.ai/artifact-preprocessor", releaseTraceName: "agent_controller.artifact_preprocess_job.release" });

		// 3. Register only controller-owned task handlers against the queues declared by the server.
		const taskPolicies = [
			{ taskName: AgentRunTaskDeclaration.taskName, queue: "agent-runs" },
			{ taskName: SkillAuthoringValidationTaskDeclaration.taskName, queue: "skill-authoring" },
			...(config.artifactPreprocessorProfile === undefined ? [] : [{ taskName: ArtifactPreprocessTaskDeclaration.taskName, queue: "artifact-preprocessing" }]),
		];
		const queueAuthority = __CreateWorkflowTaskQueueAuthority(taskPolicies);
		const runtime = _CreateAbsurdWorkflowEngine({ databasePoolSize: config.workflowDatabasePoolSize, databaseUrl: config.databaseUrl, log, pollIntervalMs: config.workflowPollIntervalMilliseconds, queueAuthority, workerConcurrency: config.workflowWorkerConcurrency });
		workflowRuntime = runtime;
		const execution = __CreateWorkflowGuard({ execution: runtime, log, queueAuthority, siloId: config.siloId });
		execution.register(__CreateWarmAgentRunWorkflowHandler({ authority: agentRunAuthority, kubernetes: agentRunKubernetes, profiles: config.warmRuntimeProfiles, pollIntervalMilliseconds: config.pollIntervalMilliseconds }));
		execution.register(__CreateSkillAuthoringValidationHandler({ authority: skillAuthoringAuthority, kubernetes: skillKubernetes, profile: config.skillAuthoringProfile, podWaitMilliseconds: config.pollIntervalMilliseconds }));
		if (config.artifactPreprocessorProfile !== undefined && artifactAuthority !== null && artifactKubernetes !== null)
		{
			execution.register(__CreateArtifactPreprocessHandler({ authority: artifactAuthority, kubernetes: artifactKubernetes, profile: config.artifactPreprocessorProfile, podWaitMilliseconds: config.pollIntervalMilliseconds }));
		}

		// 4. Convert both Kubernetes termination signals into one abortable process boundary.
		function _Shutdown(signal: string): void
		{
			if (shutdown.signal.aborted)
			{
				return;
			}
			log.info({ signal }, "agent controller shutting down");
			shutdown.abort(signal);
		}
		process.once("SIGTERM", function _sigterm() { _Shutdown("SIGTERM"); });
		process.once("SIGINT", function _sigint() { _Shutdown("SIGINT"); });
		await runtime.startWorkers({ workerName: "agent-controller" });
		log.info({ profiles: Object.entries(config.warmRuntimeProfiles).map(function _Profile([name, profile]) { return { name, namespace: profile.namespace }; }), artifactPreprocessingEnabled: config.artifactPreprocessorProfile !== undefined }, "agent controller started");
		await __RunMcpExecutorController({ authority: mcpExecutorAuthority, kubernetes: mcpKubernetes, profile: config.mcpExecutorProfile, pollIntervalMilliseconds: config.pollIntervalMilliseconds, log }, shutdown.signal);
	}
	finally
	{
		shutdown.abort("agent controller process stopped");
		if (workflowRuntime !== null)
		{
			try { await workflowRuntime.close(); }
			catch (err) { log.error({ err }, "agent controller workflow shutdown failed"); }
		}
		await ___ShutdownTelemetry();
		unbindConsole();
	}
}

void _Main().catch(function _startupFailure(err)
{
	log.error({ err }, "agent controller stopped after a fatal failure");
	process.exitCode = 1;
});
