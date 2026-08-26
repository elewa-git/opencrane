import { __CreateKubernetesGovernedJobControllerStore, type GovernedJobControllerStore, type GovernedJobControllerStoreOptions } from "@opencrane/backend/agents/runtime/workloads/k8s-controller";

/**
 * Selects the skill workload label and release trace for the shared governed Job mechanics.
 *
 * Called by: `apps/agent-controller/src/index.ts` while composing the existing skill controller.
 * @param options - Narrow Kubernetes clients plus the process request deadline and shutdown signal.
 * @returns The shared exact Job store fixed to the skill workload label.
 */
export function __CreateKubernetesSkillWorkloadControllerStore(options: Pick<GovernedJobControllerStoreOptions, "batchApi" | "coreApi" | "requestTimeoutMilliseconds" | "shutdownSignal">): GovernedJobControllerStore
{
	return __CreateKubernetesGovernedJobControllerStore({ ...options, workloadLabelKey: "opencrane.ai/skill-workload", releaseTraceName: "agent_controller.skill_job.release" });
}
