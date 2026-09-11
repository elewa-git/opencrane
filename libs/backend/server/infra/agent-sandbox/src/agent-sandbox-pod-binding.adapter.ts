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
		const claim = await this.customApi.getNamespacedCustomObject({ group: _GROUP, version: _VERSION, namespace: command.workload.namespace, plural: _PLURAL, name: command.realization.claimId }) as { readonly metadata?: { readonly labels?: Readonly<Record<string, string>> }; readonly status?: { readonly sandbox?: { readonly name?: string } } };
		const labels = claim.metadata?.labels;
		if (labels?.["opencrane.ai/computer-id"] !== command.computerId || labels["opencrane.ai/computer-generation"] !== String(command.lease.leaseGeneration) || labels["opencrane.ai/computer-lease-id"] !== command.lease.leaseId || claim.status?.sandbox?.name !== command.realization.sandboxId || command.realization.sandboxId === null || command.realization.serviceFQDN === null)
			return false;
		const sandboxName = command.realization.sandboxId;
		let sandbox: { readonly metadata?: { readonly name?: string; readonly namespace?: string }; readonly status?: { readonly service?: string; readonly serviceFQDN?: string } };
		try
		{
			sandbox = await this.customApi.getNamespacedCustomObject({ group: "agents.x-k8s.io", version: _VERSION, namespace: command.workload.namespace, plural: "sandboxes", name: sandboxName }) as typeof sandbox;
		}
		catch (error)
		{
			if (typeof error === "object" && error !== null && "code" in error && error.code === 404)
				return false;
			throw error;
		}
		const service = sandbox.status?.service;
		if (sandbox.metadata?.name !== sandboxName || sandbox.metadata.namespace !== command.workload.namespace || typeof service !== "string" || command.realization.serviceFQDN !== `${service}.${command.workload.namespace}.svc.cluster.local` || sandbox.status?.serviceFQDN !== command.realization.serviceFQDN)
			return false;
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
