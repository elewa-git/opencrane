import { isDeepStrictEqual } from "node:util";

import type { V1Job, V1Pod } from "@kubernetes/client-node";

/** Build the two-label selector that excludes Pods outside the exact owned Job attempt. */
export function _AgentRuntimePodSelector(jobName: string, workloadUid: string): string
{
	return `batch.kubernetes.io/controller-uid=${workloadUid},opencrane.ai/runtime-attempt=${jobName}`;
}

function _ExpectedPodLabels(expectedJob: V1Job, workloadUid: string): Record<string, string>
{
	const name = expectedJob.metadata?.name;
	const authored = expectedJob.spec?.template.metadata?.labels;
	if (!name || !authored) throw new Error("expected runtime Job is missing deterministic Pod labels");
	return { ...authored, "batch.kubernetes.io/controller-uid": workloadUid, "batch.kubernetes.io/job-name": name, "controller-uid": workloadUid, "job-name": name };
}

/** Reject a candidate Pod unless it is the sole exact first Pod of the fenced runtime Job. */
export function _AssertExactFirstAgentRuntimePod(pod: V1Pod, expectedJob: V1Job, workloadUid: string, serviceAccountName: string): void
{
	const jobName = expectedJob.metadata?.name;
	const namespace = expectedJob.metadata?.namespace;
	const podUid = pod.metadata?.uid;
	const ownerReferences = pod.metadata?.ownerReferences ?? [];
	const controllerOwner = ownerReferences.filter(function _controllerOwner(reference) { return reference.controller === true; });
	if (!jobName || !namespace || !podUid || pod.metadata?.namespace !== namespace || pod.spec?.serviceAccountName !== serviceAccountName || (pod.spec.serviceAccount !== undefined && pod.spec.serviceAccount !== serviceAccountName) || !isDeepStrictEqual(pod.metadata?.labels, _ExpectedPodLabels(expectedJob, workloadUid)) || ownerReferences.length !== 1 || controllerOwner.length !== 1) throw new Error("refusing to register a Pod that differs from the assigned runtime workload");
	const owner = controllerOwner[0];
	if (owner.apiVersion !== "batch/v1" || owner.kind !== "Job" || owner.name !== jobName || owner.uid !== workloadUid) throw new Error("refusing to register a Pod without the exact assigned Job owner");
}
