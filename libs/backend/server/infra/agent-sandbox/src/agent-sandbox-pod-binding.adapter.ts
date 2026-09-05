import type * as k8s from "@kubernetes/client-node";

import type { AgentSandboxPodBinding, AgentSandboxPodBindingCommand } from "./agent-sandbox-pod-binding.types";

const _GROUP = "extensions.agents.x-k8s.io";
const _VERSION = "v1beta1";
const _PLURAL = "sandboxclaims";

/** Verifies a TokenReviewed Pod against both its deterministic SandboxClaim and copied labels. */
export class AgentSandboxPodBindingAdapter implements AgentSandboxPodBinding
{
	/** Connects only the Kubernetes reads required to prove claim and Pod identity. */
	public constructor(private readonly coreApi: Pick<k8s.CoreV1Api, "listNamespacedPod">, private readonly customApi: Pick<k8s.CustomObjectsApi, "getNamespacedCustomObject">) {}

	/** Return false for missing, duplicated, foreign, stale or malformed resources. */
	public async verify(command: AgentSandboxPodBindingCommand): Promise<boolean>
	{
		const claim = await this.customApi.getNamespacedCustomObject({ group: _GROUP, version: _VERSION, namespace: command.workload.namespace, plural: _PLURAL, name: command.sandboxClaimId }) as { readonly metadata?: { readonly labels?: Readonly<Record<string, string>> }; readonly status?: { readonly sandbox?: { readonly name?: string } } };
		const labels = claim.metadata?.labels;
		if (labels?.["opencrane.ai/computer-id"] !== command.computerId || labels["opencrane.ai/computer-generation"] !== String(command.generation) || labels["opencrane.ai/computer-lease-id"] !== command.leaseId || typeof claim.status?.sandbox?.name !== "string")
			return false;
		const selector = [`opencrane.ai/computer-id=${command.computerId}`, `opencrane.ai/computer-generation=${command.generation}`, `opencrane.ai/computer-lease-id=${command.leaseId}`].join(",");
		const sandboxName = claim.status.sandbox.name;
		const pods = await this.coreApi.listNamespacedPod({ namespace: command.workload.namespace, labelSelector: selector });
		const matches = pods.items.filter(function _ExactPod(pod): boolean
		{
			return pod.metadata?.uid === command.workload.podUid
				&& pod.metadata.name === sandboxName
				&& pod.spec?.serviceAccountName === command.workload.serviceAccountName
				&& pod.metadata.labels?.["opencrane.ai/computer-id"] === command.computerId
				&& pod.metadata.labels?.["opencrane.ai/computer-generation"] === String(command.generation)
				&& pod.metadata.labels?.["opencrane.ai/computer-lease-id"] === command.leaseId;
		});
		return matches.length === 1;
	}
}
