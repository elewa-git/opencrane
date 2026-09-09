import type * as k8s from "@kubernetes/client-node";

import type { AgentSandboxPodBinding, AgentSandboxPodBindingCommand } from "./agent-sandbox-pod-binding.types";

const _GROUP = "extensions.agents.x-k8s.io";
const _VERSION = "v1beta1";
const _PLURAL = "sandboxclaims";

/**
 * Verifies a TokenReviewed Pod against its admitted claim and copied lease labels.
 *
 * The pinned controller names the Pod after the assigned Sandbox. Reading that name requires
 * only Pod get permission; the UID check rejects a replacement that reused the same name.
 *
 * Called by: `_CreateConversationComputerTurnComposition` when it composes turn admission.
 * @see AgentSandboxPodBinding
 * @see apps/_infra/agent-sandbox/tests/claim-lifecycle-smoke.sh
 */
export class AgentSandboxPodBindingAdapter implements AgentSandboxPodBinding
{
	/** Connects only the Kubernetes reads required to prove claim and Pod identity. */
	public constructor(private readonly coreApi: Pick<k8s.CoreV1Api, "readNamespacedPod">, private readonly customApi: Pick<k8s.CustomObjectsApi, "getNamespacedCustomObject">) {}

	/** Reject a missing or mismatched Pod while preserving Kubernetes authorization and transport failures. */
	public async verify(command: AgentSandboxPodBindingCommand): Promise<boolean>
	{
		const claim = await this.customApi.getNamespacedCustomObject({ group: _GROUP, version: _VERSION, namespace: command.workload.namespace, plural: _PLURAL, name: command.lease.sandboxClaimId }) as { readonly metadata?: { readonly labels?: Readonly<Record<string, string>> }; readonly status?: { readonly sandbox?: { readonly name?: string } } };
		const labels = claim.metadata?.labels;
		if (labels?.["opencrane.ai/computer-id"] !== command.computerId || labels["opencrane.ai/computer-generation"] !== String(command.lease.leaseGeneration) || labels["opencrane.ai/computer-lease-id"] !== command.lease.leaseId || typeof claim.status?.sandbox?.name !== "string")
			return false;
		const sandboxName = claim.status.sandbox.name;
		let pod: k8s.V1Pod;
		try
		{
			pod = await this.coreApi.readNamespacedPod({ namespace: command.workload.namespace, name: sandboxName });
		}
		catch (error)
		{
			if (typeof error === "object" && error !== null && "code" in error && error.code === 404)
				return false;
			throw error;
		}
		return pod.metadata?.uid === command.workload.podUid
			&& pod.metadata.name === sandboxName
			&& pod.metadata.namespace === command.workload.namespace
			&& pod.spec?.serviceAccountName === command.workload.serviceAccountName
			&& pod.metadata.labels?.["opencrane.ai/computer-id"] === command.computerId
			&& pod.metadata.labels?.["opencrane.ai/computer-generation"] === String(command.lease.leaseGeneration)
			&& pod.metadata.labels?.["opencrane.ai/computer-lease-id"] === command.lease.leaseId;
	}
}
