import { Observable, type ConfigurationOptions, type ObservableMiddleware, type RequestContext, type ResponseContext, type V1Job } from "@kubernetes/client-node";

import { __AgentRuntimeAttemptResourceName } from "@opencrane/backend/agents/runtime/k8s-launcher";

import type { KubernetesRuntimeWorkloadCleanupProjection, KubernetesRuntimeWorkloadCleanupStore, KubernetesRuntimeWorkloadCleanupStoreOptions } from "./runtime-workload-cleanup-store.types.js";

/** Attach one combined process-shutdown and request-deadline signal to a Kubernetes call. */
function _KubernetesRequestOptions(shutdownSignal: AbortSignal, timeoutMilliseconds: number): ConfigurationOptions
{
	if (!Number.isSafeInteger(timeoutMilliseconds) || timeoutMilliseconds < 1 || timeoutMilliseconds > 60_000)
	{
		throw new Error("runtime cleanup Kubernetes timeout must be between 1 and 60000 milliseconds");
	}
	const signal = AbortSignal.any([shutdownSignal, AbortSignal.timeout(timeoutMilliseconds)]);
	const middleware: ObservableMiddleware = {
		pre(context: RequestContext): Observable<RequestContext>
		{
			context.setSignal(signal);
			return new Observable(Promise.resolve(context));
		},
		post(context: ResponseContext): Observable<ResponseContext>
		{
			return new Observable(Promise.resolve(context));
		},
	};
	return { middleware: [middleware], middlewareMergeStrategy: "append" };
}

/** Read a Kubernetes HTTP status from the generated client's supported error shapes. */
function _KubernetesStatus(error: unknown): number | undefined
{
	if (typeof error !== "object" || error === null) return undefined;
	const record = error as Record<string, unknown>;
	if (typeof record.statusCode === "number") return record.statusCode;
	if (typeof record.code === "number") return record.code;
	const body = typeof record.body === "object" && record.body !== null ? record.body as Record<string, unknown> : null;
	return typeof body?.code === "number" ? body.code : undefined;
}

/** Require one expected annotation without treating resource names as authority. */
function _HasAnnotation(annotations: Record<string, string> | undefined, name: string, value: string): boolean
{
	return annotations?.[name] === value;
}

/** Verify every server-issued authority coordinate on both Job and Pod-template projections. */
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
	return job.apiVersion === "batch/v1"
		&& job.kind === "Job"
		&& job.metadata?.name === name
		&& job.metadata.namespace === workload.namespace
		&& exactLabels
		&& exactAnnotations
		&& _HasAnnotation(podAnnotations, "opencrane.ai/bootstrap-reference", workload.bootstrapReference);
}

/** Reject a Job that is not the sole exact Kubernetes projection of the fenced cleanup claim. */
function _AssertExactCleanupJob(job: V1Job, workload: KubernetesRuntimeWorkloadCleanupProjection, name: string): string
{
	// 1. Bind every durable coordinate to both levels of the Kubernetes workload projection.
	if (!_HasExactAuthorityProjection(job, workload, name))
	{
		throw new Error("refusing to clean a runtime Job outside the fenced cleanup projection");
	}

	// 2. An unassigned orphan can only be the still-suspended Job created before assignment commit.
	if (workload.mode === "unassigned_orphan" && job.spec?.suspend !== true)
	{
		throw new Error("refusing to clean an unassigned runtime Job that is not suspended");
	}

	// 3. Bind assigned cleanup to its durable UID and adopt only the API UID for an orphan claim.
	const workloadUid = job.metadata?.uid;
	if (!workloadUid) throw new Error("runtime cleanup Job is missing its Kubernetes UID");
	if (workload.workloadUid !== null && workloadUid !== workload.workloadUid)
	{
		throw new Error("refusing to clean a runtime Job whose durable UID differs from the fenced assignment");
	}
	return workloadUid;
}

/** Create the least-privilege Kubernetes adapter for exact runtime workload cleanup. */
export function __CreateKubernetesRuntimeWorkloadCleanupStore(options: KubernetesRuntimeWorkloadCleanupStoreOptions): KubernetesRuntimeWorkloadCleanupStore
{
	return {
		async deleteExactProjection(workload: KubernetesRuntimeWorkloadCleanupProjection)
		{
			const name = __AgentRuntimeAttemptResourceName(workload.siloId, workload.runId, workload.attempt);

			// 1. Read before delete so absence and exact-projection evidence remain distinct outcomes.
			let job: V1Job;
			try
			{
				job = await options.batchApi.readNamespacedJob(
					{ namespace: workload.namespace, name },
					_KubernetesRequestOptions(options.shutdownSignal, options.requestTimeoutMilliseconds),
				);
			}
			catch (error)
			{
				if (_KubernetesStatus(error) === 404) return { status: "absent" };
				throw error;
			}

			// 2. Rebind every server-issued coordinate and immutable UID before granting mutation.
			const workloadUid = _AssertExactCleanupJob(job, workload, name);

			// 3. Let Kubernetes reject resource-name reuse between the read and delete operations.
			await options.batchApi.deleteNamespacedJob(
				{ namespace: workload.namespace, name, body: { preconditions: { uid: workloadUid } } },
				_KubernetesRequestOptions(options.shutdownSignal, options.requestTimeoutMilliseconds),
			);
			return { status: "deletion_requested", workloadUid };
		},
	};
}
