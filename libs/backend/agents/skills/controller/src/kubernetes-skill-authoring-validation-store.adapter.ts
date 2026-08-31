import { __CreateKubernetesGovernedJobControllerStore, type GovernedJobControllerStore, type GovernedJobControllerStoreOptions } from "@opencrane/backend/agents/runtime/workloads/k8s-controller";

/** Creates the exact Kubernetes store used by skill-authoring validation workflows. */
export function __CreateKubernetesSkillAuthoringValidationStore(options: Pick<GovernedJobControllerStoreOptions, "batchApi" | "coreApi" | "requestTimeoutMilliseconds" | "shutdownSignal">): GovernedJobControllerStore
{
	return __CreateKubernetesGovernedJobControllerStore({ ...options, workloadLabelKey: "opencrane.ai/skill-authoring-validation", releaseTraceName: "agent_controller.skill_authoring_validation_job.release" });
}
