import type { V1Job } from "@kubernetes/client-node";

import type { KubernetesRuntimeWorkloadCleanupProjection } from "./runtime-workload-cleanup-store.types.js";

function _HasAnnotation(annotations: Record<string, string> | undefined, name: string, value: string): boolean
{
	return annotations?.[name] === value;
}

function _HasExactAuthorityProjection(job: V1Job, workload: KubernetesRuntimeWorkloadCleanupProjection, name: string): boolean
{
	const annotations = job.metadata?.annotations;
	const podAnnotations = job.spec?.template.metadata?.annotations;
	const labels = job.metadata?.labels;
	const podLabels = job.spec?.template.metadata?.labels;
	const authority = {
		"opencrane.ai/run-id": workload.runId,
		"opencrane.ai/run-attempt": String(workload.attempt),
		"opencrane.ai/agent-service-id": workload.agentServiceId,
		"opencrane.ai/agent-revision-id": workload.agentRevisionId,
		"opencrane.ai/silo-id": workload.siloId,
	};
	const exactLabels = labels?.["app.kubernetes.io/name"] === "opencrane-agent-runtime"
		&& labels["app.kubernetes.io/component"] === "agent-runtime"
		&& labels["opencrane.ai/runtime-attempt"] === name
		&& podLabels?.["app.kubernetes.io/name"] === "opencrane-agent-runtime"
		&& podLabels["app.kubernetes.io/component"] === "agent-runtime"
		&& podLabels["opencrane.ai/runtime-attempt"] === name;
	const exactAnnotations = Object.entries(authority).every(function _matches([key, value])
	{
		return _HasAnnotation(annotations, key, value) && _HasAnnotation(podAnnotations, key, value);
	});
	return job.apiVersion === "batch/v1" && job.kind === "Job" && job.metadata?.name === name && job.metadata.namespace === workload.namespace && exactLabels && exactAnnotations && _HasAnnotation(podAnnotations, "opencrane.ai/bootstrap-reference", workload.bootstrapReference);
}

/** Reject a Job that is not the sole exact Kubernetes projection of the fenced cleanup claim. */
export function _AssertExactRuntimeWorkloadCleanupJob(job: V1Job, workload: KubernetesRuntimeWorkloadCleanupProjection, name: string): string
{
	if (!_HasExactAuthorityProjection(job, workload, name)) throw new Error("refusing to clean a runtime Job outside the fenced cleanup projection");
	if (workload.mode === "unassigned_orphan" && job.spec?.suspend !== true) throw new Error("refusing to clean an unassigned runtime Job that is not suspended");
	const workloadUid = job.metadata?.uid;
	if (!workloadUid) throw new Error("runtime cleanup Job is missing its Kubernetes UID");
	if (workload.workloadUid !== null && workloadUid !== workload.workloadUid) throw new Error("refusing to clean a runtime Job whose durable UID differs from the fenced assignment");
	return workloadUid;
}
