import "./instrument";

import * as k8s from "@kubernetes/client-node";

import { __CreateHttpAgentControllerAuthority, __CreateKubernetesAgentControllerStore, __RunAgentController } from "@opencrane/backend/agents/runtime/controller";
import { __CreateHttpSkillAuthoringValidationControllerAuthority, __CreateHttpSkillWorkloadControllerAuthority, __CreateKubernetesSkillWorkloadControllerStore, __CreateSkillAuthoringValidationHandler, __RunSkillWorkloadController, type SkillAuthoringValidationKubernetesStore, type SkillWorkloadControllerKubernetesStore } from "@opencrane/backend/agents/skills/controller";
import { __CreateHttpMcpbValidationControllerAuthority, __CreateKubernetesMcpbValidationControllerStore, __RunMcpbValidationController } from "@opencrane/backend/agents/mcpb/controller";
import { ___BindConsole, ___ShutdownTelemetry } from "@opencrane/backend/observability";
import { _CreateAbsurdWorkflowEngine } from "@opencrane/backend/server/infra/workflows/infra_absurd";
import { __CreateWorkflowGuard, __CreateWorkflowTaskQueueAuthority } from "@opencrane/backend/server/infra/workflows/guard";
import { SkillAuthoringValidationTaskDeclaration } from "@opencrane/backend/agents/skills/workflows/contract";

import { _ReadConfig } from "./config";
import { _log as log } from "./log";

/** Adapts the governed-skill Kubernetes implementation to the durable authoring handler's narrow port. */
function _CreateSkillAuthoringValidationKubernetesStore(store: SkillWorkloadControllerKubernetesStore): SkillAuthoringValidationKubernetesStore
{
	return {
		async ensureSuspendedJob(expected)
		{
			return await store.__EnsureSuspendedJob(expected);
		},
		async releaseJob(expected, jobUid, claimExpiresAt)
		{
			return await store.__EnsureSkillJobReleased(expected, jobUid, claimExpiresAt);
		},
		async findFirstPod(expected, jobUid, serviceAccountName)
		{
			return await store.__FindFirstSkillWorkloadPod(expected, jobUid, serviceAccountName);
		},
	};
}

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
		const skillAuthoringValidationAuthority = __CreateHttpSkillAuthoringValidationControllerAuthority({ openCraneInternalUrl: config.openCraneInternalUrl, tokenPath: config.controllerTokenPath, requestTimeoutMilliseconds: config.requestTimeoutMilliseconds, shutdownSignal: shutdown.signal });
		const mcpbValidationAuthority = __CreateHttpMcpbValidationControllerAuthority({ openCraneInternalUrl: config.openCraneInternalUrl, tokenPath: config.controllerTokenPath, requestTimeoutMilliseconds: config.requestTimeoutMilliseconds });
		const kubernetes = __CreateKubernetesAgentControllerStore({ batchApi: kubeConfig.makeApiClient(k8s.BatchV1Api), coreApi: kubeConfig.makeApiClient(k8s.CoreV1Api), requestTimeoutMilliseconds: config.requestTimeoutMilliseconds, shutdownSignal: shutdown.signal });
		const skillKubernetes = __CreateKubernetesSkillWorkloadControllerStore({ batchApi: kubeConfig.makeApiClient(k8s.BatchV1Api), coreApi: kubeConfig.makeApiClient(k8s.CoreV1Api), requestTimeoutMilliseconds: config.requestTimeoutMilliseconds, shutdownSignal: shutdown.signal });
		const mcpbKubernetes = __CreateKubernetesMcpbValidationControllerStore({ batchApi: kubeConfig.makeApiClient(k8s.BatchV1Api), requestTimeoutMilliseconds: config.requestTimeoutMilliseconds, shutdownSignal: shutdown.signal });
		const queueAuthority = __CreateWorkflowTaskQueueAuthority([{ taskName: SkillAuthoringValidationTaskDeclaration.taskName, queue: "skill-authoring" }]);
		const workflowRuntime = _CreateAbsurdWorkflowEngine({ databaseUrl: config.workflowDatabaseUrl, databasePoolSize: config.workflowDatabasePoolSize, log, pollIntervalMs: config.pollIntervalMilliseconds, queueAuthority, workerConcurrency: config.workflowWorkerConcurrency });
		const workflowExecution = __CreateWorkflowGuard({ execution: workflowRuntime, log, queueAuthority, siloId: config.workflowSiloId });
		workflowExecution.register(__CreateSkillAuthoringValidationHandler({ authority: skillAuthoringValidationAuthority, kubernetes: _CreateSkillAuthoringValidationKubernetesStore(skillKubernetes), profile: config.skillWorkloadProfiles.authoring, podWaitMilliseconds: config.pollIntervalMilliseconds }));

		// 3. Convert both Kubernetes termination signals into one abortable poll loop.
		function _Shutdown(signal: string): void
		{
			if (shutdown.signal.aborted) return;
			log.info({ signal }, "agent controller shutting down");
			shutdown.abort(signal);
		}
		process.once("SIGTERM", function _sigterm() { _Shutdown("SIGTERM"); });
		process.once("SIGINT", function _sigint() { _Shutdown("SIGINT"); });
		try
		{
			// 3. Start the remote durable worker before the legacy loops, so admitted validation tasks do not wait for a restart.
			await workflowRuntime.startWorkers({ workerName: "agent-controller-skill-authoring" });
			log.info({ profiles: Object.entries(config.profiles).map(function _profile([name, profile]) { return { name, namespace: profile.namespace }; }), workflowSiloId: config.workflowSiloId }, "agent controller started");
			await Promise.all([
				__RunAgentController({ authority, kubernetes, profiles: config.profiles, pollIntervalMilliseconds: config.pollIntervalMilliseconds, outboxPruneIntervalMilliseconds: config.outboxPruneIntervalMilliseconds, log }, shutdown.signal),
				__RunSkillWorkloadController({ authority: skillWorkloadAuthority, kubernetes: skillKubernetes, profiles: config.skillWorkloadProfiles, pollIntervalMilliseconds: config.pollIntervalMilliseconds, log }, shutdown.signal),
				__RunMcpbValidationController({ authority: mcpbValidationAuthority, kubernetes: mcpbKubernetes, profile: config.mcpbValidatorProfile, pollIntervalMilliseconds: config.pollIntervalMilliseconds, log }, shutdown.signal),
			]);
		}
		finally
		{
			await workflowRuntime.close();
		}
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
