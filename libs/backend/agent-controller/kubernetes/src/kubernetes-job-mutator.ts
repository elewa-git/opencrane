import * as k8s from "@kubernetes/client-node";

import type { AgentJobMutator, AgentJobProjection, ObservedAgentJob } from "@opencrane/backend/agent-controller";

/** Kubernetes-only adapter that projects exact controller-approved Jobs. */
export class _KubernetesAgentJobMutator implements AgentJobMutator
{
	/** Batch API client with namespaced Job permissions only. */
	private readonly batchApi: k8s.BatchV1Api;
	/** Core API client with namespaced Pod read permissions only. */
	private readonly coreApi: k8s.CoreV1Api;

	/** Creates the bounded Kubernetes controller adapter. */
	constructor(batchApi: k8s.BatchV1Api, coreApi: k8s.CoreV1Api)
	{
		this.batchApi = batchApi;
		this.coreApi = coreApi;
	}

	/** Proves the Kubernetes API is reachable and this controller retains its namespaced Job-list grant. */
	async check(namespace: string): Promise<void>
	{
		await this.batchApi.listNamespacedJob({ namespace, limit: 1 });
	}

	/** Reads one deterministic Job without treating an absent Job as an error. */
	async get(projection: AgentJobProjection): Promise<ObservedAgentJob | null>
	{
		try
		{
			return _observed(await this.batchApi.readNamespacedJob({ namespace: projection.namespace, name: projection.name }));
		}
		catch (error)
		{
			if (_status(error) === 404) return null;
			throw error;
		}
	}

	/** Creates only a suspended, non-retrying Job with no Kubernetes API token. */
	async createSuspended(projection: AgentJobProjection): Promise<ObservedAgentJob>
	{
		return _observed(await this.batchApi.createNamespacedJob({
			namespace: projection.namespace,
			body: {
				apiVersion: "batch/v1",
				kind: "Job",
				metadata: { name: projection.name, labels: projection.labels },
				spec: {
					suspend: true,
					backoffLimit: projection.backoffLimit,
					template: {
						metadata: { labels: projection.labels },
						spec: {
							serviceAccountName: projection.serviceAccountName,
							automountServiceAccountToken: false,
							restartPolicy: "Never",
							containers: [{
								name: "agent-runtime",
								image: projection.image,
								securityContext: {
									allowPrivilegeEscalation: false,
									capabilities: { drop: ["ALL"] },
									readOnlyRootFilesystem: true,
								},
							}],
						},
					},
				},
			},
		}));
	}

	/** Deletes only the exact previously observed Job UID. */
	async delete(projection: AgentJobProjection, workloadUid: string): Promise<void>
	{
		await this.batchApi.deleteNamespacedJob({ namespace: projection.namespace, name: projection.name, body: { preconditions: { uid: workloadUid } } });
	}

	/** Unsuspends only the exact previously observed Job UID. */
	async unsuspend(projection: AgentJobProjection, workloadUid: string): Promise<void>
	{
		await this.batchApi.patchNamespacedJob({ namespace: projection.namespace, name: projection.name, body: { metadata: { uid: workloadUid }, spec: { suspend: false } } });
	}

	/** Returns the first Pod owned by the exact acknowledged Job UID. */
	async firstPodUid(projection: AgentJobProjection, workloadUid: string): Promise<string | null>
	{
		const pods = await this.coreApi.listNamespacedPod({ namespace: projection.namespace, labelSelector: `job-name=${projection.name}` });
		const pod = pods.items.find(function _owned(item) { return item.metadata?.uid !== undefined && item.metadata.ownerReferences?.some(function _owner(owner) { return owner.uid === workloadUid && owner.controller === true; }) === true; });
		return pod?.metadata?.uid ?? null;
	}
}

/** Maps only a Kubernetes Job with immutable identity and observed labels. */
function _observed(job: k8s.V1Job): ObservedAgentJob
{
	const name = job.metadata?.name;
	const uid = job.metadata?.uid;
	if (name === undefined || uid === undefined) throw new Error("Kubernetes returned a Job without immutable identity");
	return { name, uid, labels: job.metadata?.labels ?? {}, suspended: job.spec?.suspend === true };
}

/** Reads an API status code from the Kubernetes client error shape. */
function _status(error: unknown): number | null
{
	return typeof error === "object" && error !== null && "code" in error && typeof error.code === "number" ? error.code : null;
}
