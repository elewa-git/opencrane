import * as k8s from "@kubernetes/client-node";

import { __CreateHttpAgentControllerAuthority, __CreateKubernetesAgentControllerStore, __RunAgentController } from "@opencrane/backend/agents/runtime/controller";
import { __CreateHttpMcpExecutorControllerAuthority, __CreateKubernetesMcpExecutorControllerStore, __RunMcpExecutorController } from "@opencrane/backend/agents/runtime/mcp-executor/controller";
import { __CreateHttpSkillWorkloadControllerAuthority, __CreateKubernetesSkillWorkloadControllerStore, __RunSkillWorkloadController } from "@opencrane/backend/agents/skills/controller";

import type { AgentControllerProcessConfig } from "./config.types";
import { _log as log } from "./log";

/**
 * Composes the three outbound controller loops from one checked process configuration.
 *
 * The application creates independent Kubernetes API clients for each narrow adapter, but all
 * loops share the same shutdown signal. This keeps app startup separate from controller logic
 * while preserving one process-wide drain boundary.
 *
 * Called by: src/index.ts.
 * @param config - Fully checked deployment-owned controller configuration.
 * @param signal - Process shutdown signal shared by every outbound request and poll loop.
 * @returns A promise that settles after every controller loop drains.
 */
export async function _RunControllerRuntime(config: AgentControllerProcessConfig, signal: AbortSignal): Promise<void>
{
	// 1. Load the in-cluster identity once, then give each adapter its own narrow API client.
	const kubeConfig = new k8s.KubeConfig();
	kubeConfig.loadFromCluster();
	const authority = __CreateHttpAgentControllerAuthority({ openCraneInternalUrl: config.openCraneInternalUrl, tokenPath: config.controllerTokenPath, requestTimeoutMilliseconds: config.requestTimeoutMilliseconds });
	const skillWorkloadAuthority = __CreateHttpSkillWorkloadControllerAuthority({ openCraneInternalUrl: config.openCraneInternalUrl, tokenPath: config.controllerTokenPath, requestTimeoutMilliseconds: config.requestTimeoutMilliseconds });
	const mcpExecutorAuthority = __CreateHttpMcpExecutorControllerAuthority({ openCraneInternalUrl: config.openCraneInternalUrl, tokenPath: config.controllerTokenPath, requestTimeoutMilliseconds: config.requestTimeoutMilliseconds });
	const kubernetes = __CreateKubernetesAgentControllerStore({ batchApi: kubeConfig.makeApiClient(k8s.BatchV1Api), coreApi: kubeConfig.makeApiClient(k8s.CoreV1Api), requestTimeoutMilliseconds: config.requestTimeoutMilliseconds, shutdownSignal: signal });
	const skillKubernetes = __CreateKubernetesSkillWorkloadControllerStore({ batchApi: kubeConfig.makeApiClient(k8s.BatchV1Api), coreApi: kubeConfig.makeApiClient(k8s.CoreV1Api), requestTimeoutMilliseconds: config.requestTimeoutMilliseconds, shutdownSignal: signal });
	const mcpKubernetes = __CreateKubernetesMcpExecutorControllerStore({ batchApi: kubeConfig.makeApiClient(k8s.BatchV1Api), coreApi: kubeConfig.makeApiClient(k8s.CoreV1Api), requestTimeoutMilliseconds: config.requestTimeoutMilliseconds, shutdownSignal: signal });

	// 2. Start each bounded reconciler together, so a failure still reaches the one app-level drain path.
	log.info({ profiles: Object.entries(config.profiles).map(function _Profile([name, profile]) { return { name, namespace: profile.namespace }; }) }, "agent controller started");
	await Promise.all([
		__RunAgentController({ authority, kubernetes, profiles: config.profiles, pollIntervalMilliseconds: config.pollIntervalMilliseconds, outboxPruneIntervalMilliseconds: config.outboxPruneIntervalMilliseconds, log }, signal),
		__RunSkillWorkloadController({ authority: skillWorkloadAuthority, kubernetes: skillKubernetes, profiles: config.skillWorkloadProfiles, pollIntervalMilliseconds: config.pollIntervalMilliseconds, log }, signal),
		__RunMcpExecutorController({ authority: mcpExecutorAuthority, kubernetes: mcpKubernetes, profile: config.mcpExecutorProfile, pollIntervalMilliseconds: config.pollIntervalMilliseconds, log }, signal),
	]);
}
