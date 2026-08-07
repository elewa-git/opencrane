import { Observable, type ConfigurationOptions, type ObservableMiddleware, type RequestContext, type ResponseContext, type V1Job } from "@kubernetes/client-node";

import { __AgentRuntimeAttemptResourceName } from "@opencrane/backend/agents/runtime/k8s-launcher";
import { ___DoWithTrace } from "@opencrane/backend/observability";

import { _AssertExactRuntimeWorkloadCleanupJob } from "./runtime-workload-cleanup-projection.js";
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

/** Create the least-privilege Kubernetes adapter for exact runtime workload cleanup. */
export function __CreateKubernetesRuntimeWorkloadCleanupStore(options: KubernetesRuntimeWorkloadCleanupStoreOptions): KubernetesRuntimeWorkloadCleanupStore
{
	return {
		async deleteExactProjection(workload: KubernetesRuntimeWorkloadCleanupProjection)
		{
			const name = __AgentRuntimeAttemptResourceName(workload.siloId, workload.runId, workload.attempt);
			return ___DoWithTrace("runtime_cleanup.job.delete_exact", { runId: workload.runId, attempt: workload.attempt, namespace: workload.namespace }, async function _deleteExactProjection()
			{
				let job: V1Job;
				try
				{
					job = await options.batchApi.readNamespacedJob({ namespace: workload.namespace, name }, _KubernetesRequestOptions(options.shutdownSignal, options.requestTimeoutMilliseconds));
				}
				catch (error)
				{
					if (_KubernetesStatus(error) === 404) return { status: "absent" };
					throw error;
				}
				const workloadUid = _AssertExactRuntimeWorkloadCleanupJob(job, workload, name);
				await options.batchApi.deleteNamespacedJob({ namespace: workload.namespace, name, body: { preconditions: { uid: workloadUid } } }, _KubernetesRequestOptions(options.shutdownSignal, options.requestTimeoutMilliseconds));
				return { status: "deletion_requested", workloadUid };
			});
		},
	};
}
