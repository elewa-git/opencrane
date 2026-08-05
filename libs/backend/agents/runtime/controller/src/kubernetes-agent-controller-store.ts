import { Observable, type ConfigurationOptions, type ObservableMiddleware, type RequestContext, type ResponseContext, type V1Job } from "@kubernetes/client-node";
import { ___DoWithTrace } from "@opencrane/backend/observability";

import type { AgentControllerKubernetesStore } from "./agent-controller.types.js";
import { _AssertExactAssignedAgentRuntimeJob, _AssertExactSuspendedAgentRuntimeJob } from "./kubernetes-agent-job-adoption.js";
import { _AssertReleasedAgentRuntimeAssignmentDeadline, _PlanAgentRuntimeJobRelease } from "./kubernetes-agent-job-release.js";
import type { AgentControllerKubernetesStoreOptions } from "./kubernetes-agent-controller-store.types.js";
import { _AgentRuntimePodSelector, _AssertExactFirstAgentRuntimePod } from "./kubernetes-runtime-pod.js";

function _KubernetesRequestOptions(shutdownSignal: AbortSignal, timeoutMilliseconds: number): ConfigurationOptions
{
	const signal = AbortSignal.any([shutdownSignal, AbortSignal.timeout(timeoutMilliseconds)]);
	const middleware: ObservableMiddleware = {
		pre(context: RequestContext): Observable<RequestContext> { context.setSignal(signal); return new Observable(Promise.resolve(context)); },
		post(context: ResponseContext): Observable<ResponseContext> { return new Observable(Promise.resolve(context)); },
	};
	return { middleware: [middleware], middlewareMergeStrategy: "append" };
}

function _StatusCode(err: unknown): number | undefined
{
	if (typeof err !== "object" || err === null) return undefined;
	const record = err as Record<string, unknown>;
	if (typeof record.statusCode === "number") return record.statusCode;
	if (typeof record.code === "number") return record.code;
	const body = typeof record.body === "object" && record.body !== null ? record.body as Record<string, unknown> : null;
	return typeof body?.code === "number" ? body.code : undefined;
}

function _Coordinates(resource: V1Job): { readonly name: string; readonly namespace: string }
{
	const name = resource.metadata?.name;
	const namespace = resource.metadata?.namespace;
	if (!name || !namespace) throw new Error("agent-controller resources require deterministic namespaced metadata");
	return { name, namespace };
}

/** Create the least-privilege Kubernetes projection and release adapter. */
export function __CreateKubernetesAgentControllerStore(options: AgentControllerKubernetesStoreOptions): AgentControllerKubernetesStore
{
	if (!Number.isSafeInteger(options.requestTimeoutMilliseconds) || options.requestTimeoutMilliseconds < 1_000 || options.requestTimeoutMilliseconds > 60_000) throw new Error("agent controller Kubernetes store requires a 1-60s request timeout");
	return {
		async __EnsureSuspendedJob(expected)
		{
			const { name, namespace } = _Coordinates(expected);
			return ___DoWithTrace("agent_controller.job.ensure", { name, namespace }, async function _ensureSuspendedJob()
			{
				try
				{
					const created = await options.batchApi.createNamespacedJob({ namespace, body: expected }, _KubernetesRequestOptions(options.shutdownSignal, options.requestTimeoutMilliseconds));
					_AssertExactSuspendedAgentRuntimeJob(created, expected);
					return created;
				}
				catch (err)
				{
					if (_StatusCode(err) !== 409) throw err;
					const current = await options.batchApi.readNamespacedJob({ namespace, name }, _KubernetesRequestOptions(options.shutdownSignal, options.requestTimeoutMilliseconds));
					_AssertExactSuspendedAgentRuntimeJob(current, expected);
					return current;
				}
			});
		},
		async __EnsureAttemptKeySecret(expected)
		{
			const name = expected.metadata?.name;
			const namespace = expected.metadata?.namespace;
			if (!name || !namespace) throw new Error("agent-controller attempt-key Secret requires deterministic namespaced metadata");
			await ___DoWithTrace("agent_controller.secret.ensure", { name, namespace }, async function _ensureAttemptKeySecret(): Promise<void>
			{
				try
				{
					await options.coreApi.createNamespacedSecret({ namespace, body: expected }, _KubernetesRequestOptions(options.shutdownSignal, options.requestTimeoutMilliseconds));
				}
				catch (err)
				{
					// Create-only Role: the deterministic name and isolated writer make 409 the exact replay.
					if (_StatusCode(err) !== 409) throw err;
				}
			});
		},
		async __EnsureRuntimeJobReleased(expected, workloadUid, assignmentExpiresAt, releaseLeaseExpiresAt)
		{
			const { name, namespace } = _Coordinates(expected);
			return ___DoWithTrace("agent_controller.job.release", { name, namespace, workloadUid, assignmentExpiresAt }, async function _releaseRuntimeJob()
			{
				const current = await options.batchApi.readNamespacedJob({ namespace, name }, _KubernetesRequestOptions(options.shutdownSignal, options.requestTimeoutMilliseconds));
				_AssertExactAssignedAgentRuntimeJob(current, expected, workloadUid);
				if (current.spec?.suspend === false)
				{
					_AssertReleasedAgentRuntimeAssignmentDeadline(current, assignmentExpiresAt);
					return current;
				}
				const plan = _PlanAgentRuntimeJobRelease(current, expected, assignmentExpiresAt, releaseLeaseExpiresAt, options.requestTimeoutMilliseconds);
				const released = await options.batchApi.patchNamespacedJob(plan.patch, _KubernetesRequestOptions(options.shutdownSignal, options.requestTimeoutMilliseconds));
				_AssertExactAssignedAgentRuntimeJob(released, expected, workloadUid);
				if (released.spec?.suspend !== false) throw new Error("Kubernetes did not release the exact assigned runtime Job");
				_AssertReleasedAgentRuntimeAssignmentDeadline(released, plan.canonicalAssignmentExpiresAt, plan.activeDeadlineSeconds);
				return released;
			});
		},
		async __FindFirstRuntimePod(expectedJob, workloadUid, serviceAccountName)
		{
			const { name, namespace } = _Coordinates(expectedJob);
			return ___DoWithTrace("agent_controller.pod.find_first", { name, namespace, workloadUid }, async function _findFirstRuntimePod()
			{
				const listed = await options.coreApi.listNamespacedPod({ namespace, labelSelector: _AgentRuntimePodSelector(name, workloadUid) }, _KubernetesRequestOptions(options.shutdownSignal, options.requestTimeoutMilliseconds));
				if (listed.items.length === 0) return null;
				if (listed.items.length !== 1) throw new Error("refusing to choose among multiple Pods for one assigned runtime Job");
				_AssertExactFirstAgentRuntimePod(listed.items[0], expectedJob, workloadUid, serviceAccountName);
				return listed.items[0];
			});
		},
	};
}
