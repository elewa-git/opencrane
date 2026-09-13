import type * as k8s from "@kubernetes/client-node";

import type { RuntimeWorkloadIdentity } from "@opencrane/backend/server/infra/workload-identity";
import type { AgentSandboxPodBinding, AgentSandboxPodBindingCommand, AgentSandboxPodResolutionCommand } from "./agent-sandbox-pod-binding.types";

const _GROUP = "extensions.agents.x-k8s.io";
const _VERSION = "v1beta1";
const _PLURAL = "sandboxclaims";

/**
 * Verifies a TokenReviewed Pod against its admitted claim and copied lease labels.
 *
 * The pinned controller names the Pod after the assigned Sandbox. Reading that name requires
 * only Pod get permission; the UID check rejects a replacement that reused the same name.
 *
 * Called by the OpenCrane conversation workflow composition before a server-owned sandbox effect.
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
		const resolved = await this.resolve({ computerId: command.computerId, lease: command.lease, namespace: command.workload.namespace, serviceAccountName: command.workload.serviceAccountName });
		return resolved?.podUid === command.workload.podUid && resolved.subject === command.workload.subject;
	}

	/** Read the claim and assigned Pod using only release-fixed server authority. */
	public async resolve(command: AgentSandboxPodResolutionCommand): Promise<RuntimeWorkloadIdentity | null>
	{
		const claim = await this.customApi.getNamespacedCustomObject({ group: _GROUP, version: _VERSION, namespace: command.namespace, plural: _PLURAL, name: command.lease.sandboxClaimId }) as { readonly metadata?: { readonly labels?: Readonly<Record<string, string>> }; readonly status?: { readonly sandbox?: { readonly name?: string } } };
		const labels = claim.metadata?.labels;
		if (labels?.["opencrane.ai/computer-id"] !== command.computerId || labels["opencrane.ai/computer-generation"] !== String(command.lease.leaseGeneration) || labels["opencrane.ai/computer-lease-id"] !== command.lease.leaseId || typeof claim.status?.sandbox?.name !== "string")
			return null;
		const sandboxName = claim.status.sandbox.name;
		let pod: k8s.V1Pod;
		try
		{
			pod = await this.coreApi.readNamespacedPod({ namespace: command.namespace, name: sandboxName });
		}
		catch (error)
		{
			if (typeof error === "object" && error !== null && "code" in error && error.code === 404)
				return null;
			throw error;
		}
		const podLabels = pod.metadata?.labels;
		if (typeof pod.metadata?.uid !== "string"
			|| pod.metadata.name !== sandboxName
			|| pod.metadata.namespace !== command.namespace
			|| pod.spec?.serviceAccountName !== command.serviceAccountName
			|| podLabels?.["opencrane.ai/computer-id"] !== command.computerId
			|| podLabels["opencrane.ai/computer-generation"] !== String(command.lease.leaseGeneration)
			|| podLabels["opencrane.ai/computer-lease-id"] !== command.lease.leaseId)
			return null;
		return { subject: `system:serviceaccount:${command.namespace}:${command.serviceAccountName}`, namespace: command.namespace, serviceAccountName: command.serviceAccountName, podUid: pod.metadata.uid };
	}
}
