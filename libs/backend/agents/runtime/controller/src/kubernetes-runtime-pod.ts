import { isDeepStrictEqual } from "node:util";

import type { V1Job, V1Pod } from "@kubernetes/client-node";

/**
 * Build the two-label selector that matches only Pods belonging to this exact Job attempt.
 *
 * Both labels are needed: the attempt name alone would still match a Pod left behind by an earlier
 * Job of the same name, and the controller UID pins it to this Job instance.
 *
 * Called by: the Pod-find path in kubernetes-agent-controller-store.ts.
 * @param jobName - The attempt's derived Job name.
 * @param workloadUid - UID recorded at assignment.
 * @returns A Kubernetes label selector string.
 */
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

/**
 * Throw unless this Pod really is the assigned Job's own first Pod.
 *
 * Four things must hold: it is in the Job's namespace, its labels are exactly the template's labels
 * plus the four Kubernetes adds, it runs as the expected ServiceAccount, and it has exactly one
 * owner — the assigned Job, by name and UID. This runs before the Pod UID is recorded, and that
 * recorded UID is what the bootstrap exchange later checks, so registering the wrong Pod would
 * hand an attempt's credentials to something else.
 *
 * Called by: the Pod-find path in kubernetes-agent-controller-store.ts, after the label-selector
 * list has returned exactly one Pod.
 * @param pod - The candidate Pod as Kubernetes holds it.
 * @param expectedJob - The Job rebuilt from recorded coordinates, supplying namespace and labels.
 * @param workloadUid - UID recorded at assignment; the Pod's owner UID must equal it.
 * @param serviceAccountName - The ServiceAccount the Pod must be running as.
 * @throws When any of the four checks fails. The caller must not register the Pod.
 */
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
