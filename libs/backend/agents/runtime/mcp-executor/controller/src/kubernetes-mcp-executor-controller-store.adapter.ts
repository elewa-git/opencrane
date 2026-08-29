import { __CreateKubernetesGovernedJobControllerStore, type GovernedJobControllerStore, type GovernedJobControllerStoreOptions } from "@opencrane/backend/agents/runtime/workloads/k8s-controller";

/**
 * Selects MCP-owned labels and tracing for the shared governed Job checks.
 *
 * Called by: `apps/agent-controller/src/index.ts` while composing the MCP controller.
 * @param options - Kubernetes clients plus the process deadline and shutdown signal.
 * @returns The shared Job store configured for MCP executor Jobs.
 */
export function __CreateKubernetesMcpExecutorControllerStore(options: Pick<GovernedJobControllerStoreOptions, "batchApi" | "coreApi" | "requestTimeoutMilliseconds" | "shutdownSignal">): GovernedJobControllerStore
{
	return __CreateKubernetesGovernedJobControllerStore({ ...options, workloadLabelKey: "opencrane.ai/mcp-workload", releaseTraceName: "agent_controller.mcp_executor_job.release" });
}
