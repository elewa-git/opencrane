import { isDeepStrictEqual } from "node:util";

import { Observable, type ConfigurationOptions, type ObservableMiddleware, type RequestContext, type ResponseContext, type V1Job, type V1ObjectMeta, type V1Pod } from "@kubernetes/client-node";
import { ___DoWithTrace } from "@opencrane/observability";

import type { SkillWorkloadControllerKubernetesStore, SkillWorkloadControllerKubernetesStoreOptions } from "./skill-workload-controller.types.js";

/** Kubernetes-generated metadata excluded from the controller-owned Job contract. */
const _SERVER_METADATA_FIELDS = ["creationTimestamp", "generation", "managedFields", "resourceVersion", "selfLink", "uid"] as const;

/** Attach the shutdown and request deadline to one Kubernetes client call. */
function _RequestOptions(shutdownSignal: AbortSignal, timeoutMilliseconds: number): ConfigurationOptions
{
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

/** Extract a generated Kubernetes HTTP status from a supported error shape. */
function _StatusCode(err: unknown): number | undefined
{
	if (typeof err !== "object" || err === null) return undefined;
	const record = err as Record<string, unknown>;
	if (typeof record.statusCode === "number") return record.statusCode;
	if (typeof record.code === "number") return record.code;
	return undefined;
}

/** Require the deterministic coordinates that scope every Kubernetes request. */
function _Coordinates(job: V1Job): { readonly name: string; readonly namespace: string }
{
	const name = job.metadata?.name;
	const namespace = job.metadata?.namespace;
	if (!name || !namespace) throw new Error("governed skill Job requires deterministic namespaced metadata");
	return { name, namespace };
}

/** Remove API bookkeeping while retaining all controller-authored metadata. */
function _OwnedMetadata(metadata: V1ObjectMeta | undefined): V1ObjectMeta
{
	const owned = structuredClone(metadata ?? {});
	for (const field of _SERVER_METADATA_FIELDS) delete (owned as Record<string, unknown>)[field];
	return owned;
}

/** Normalize only documented Kubernetes defaults and UID-generated Job selectors. */
function _NormalizedJob(job: V1Job): Record<string, unknown>
{
	const normalized = structuredClone(job) as unknown as Record<string, unknown>;
	delete normalized.status;
	normalized.metadata = _OwnedMetadata(job.metadata) as unknown as Record<string, unknown>;
	const spec = normalized.spec as Record<string, unknown>;
	const selector = spec.selector as Record<string, unknown> | undefined;
	if (selector)
	{
		const template = spec.template as Record<string, unknown>;
		const metadata = template.metadata as Record<string, unknown>;
		const labels = metadata.labels as Record<string, unknown> | undefined;
		const matchLabels = selector.matchLabels as Record<string, unknown> | undefined;
		const expected = { "batch.kubernetes.io/controller-uid": job.metadata?.uid, "batch.kubernetes.io/job-name": job.metadata?.name, "controller-uid": job.metadata?.uid, "job-name": job.metadata?.name };
		if (!matchLabels || !labels || !isDeepStrictEqual(matchLabels, expected) || !Object.entries(expected).every(function _MatchesGenerated([key, value]): boolean { return labels[key] === value; })) throw new Error("refusing to adopt a governed skill Job with unexpected Kubernetes selectors");
		for (const key of Object.keys(expected)) delete labels[key];
		delete spec.selector;
	}
	if (spec.manualSelector === false) delete spec.manualSelector;
	if (spec.completionMode === "NonIndexed") delete spec.completionMode;
	const podSpec = ((spec.template as Record<string, unknown>).spec as Record<string, unknown>);
	if (podSpec.serviceAccount === podSpec.serviceAccountName) delete podSpec.serviceAccount;
	if (podSpec.dnsPolicy === "ClusterFirst") delete podSpec.dnsPolicy;
	if (podSpec.schedulerName === "default-scheduler") delete podSpec.schedulerName;
	if (podSpec.terminationGracePeriodSeconds === 30) delete podSpec.terminationGracePeriodSeconds;
	return normalized;
}

/** Assert that a Job is the exact UID-bound assignment, with only release state permitted to vary. */
function _AssertExactAssignedJob(current: V1Job, expected: V1Job, workloadUid: string): void
{
	if (current.metadata?.uid !== workloadUid || (current.spec?.suspend !== true && current.spec?.suspend !== false)) throw new Error("refusing to adopt a Job outside the exact durable skill workload assignment");
	const comparable = structuredClone(expected);
	if (!comparable.spec) throw new Error("expected governed skill Job is missing a specification");
	const currentDeadline = current.spec?.activeDeadlineSeconds;
	const maximumDeadline = expected.spec?.activeDeadlineSeconds;
	comparable.spec.suspend = current.spec.suspend;
	if (current.spec.suspend === false)
	{
		if (typeof currentDeadline !== "number" || typeof maximumDeadline !== "number" || !Number.isSafeInteger(currentDeadline) || !Number.isSafeInteger(maximumDeadline) || currentDeadline < 1 || currentDeadline > maximumDeadline) throw new Error("released governed skill Job has an invalid bounded lifetime");
		comparable.spec.activeDeadlineSeconds = currentDeadline;
	}
	if (!isDeepStrictEqual(_NormalizedJob(current), _NormalizedJob(comparable))) throw new Error("refusing to adopt a Job that differs from the assigned governed skill workload");
}

/** Require the API identity used by the conditional unsuspend patch. */
function _ReleaseIdentity(job: V1Job): { readonly name: string; readonly namespace: string; readonly uid: string; readonly resourceVersion: string }
{
	const { name, namespace } = _Coordinates(job);
	const uid = job.metadata?.uid;
	const resourceVersion = job.metadata?.resourceVersion;
	if (!uid || !resourceVersion) throw new Error("assigned governed skill Job is missing UID or resourceVersion for release");
	return { name, namespace, uid, resourceVersion };
}

/** Bound the Job's active lifetime to the database-issued release expiry. */
function _ReleaseDeadline(expected: V1Job, releaseExpiresAt: string, requestTimeoutMilliseconds: number): number
{
	const expiry = Date.parse(releaseExpiresAt);
	const maximum = expected.spec?.activeDeadlineSeconds;
	const remaining = Math.floor((expiry - Date.now() - requestTimeoutMilliseconds) / 1_000);
	if (!Number.isSafeInteger(expiry) || !Number.isSafeInteger(maximum) || maximum === undefined || maximum < 1 || remaining < 1) throw new Error("governed skill release claim expired before Kubernetes release");
	return Math.min(maximum, remaining);
}

/** Assert that a listed Pod is the one exact Job-owned worker eligible for bootstrap binding. */
function _AssertExactPod(pod: V1Pod, expectedJob: V1Job, workloadUid: string, serviceAccountName: string): void
{
	const name = expectedJob.metadata?.name;
	const namespace = expectedJob.metadata?.namespace;
	const labels = expectedJob.spec?.template.metadata?.labels;
	const expectedLabels = { ...labels, "batch.kubernetes.io/controller-uid": workloadUid, "batch.kubernetes.io/job-name": name, "controller-uid": workloadUid, "job-name": name };
	const owners = pod.metadata?.ownerReferences ?? [];
	if (!name || !namespace || !pod.metadata?.uid || pod.metadata.namespace !== namespace || pod.spec?.serviceAccountName !== serviceAccountName || !isDeepStrictEqual(pod.metadata?.labels, expectedLabels) || owners.length !== 1 || owners[0]?.apiVersion !== "batch/v1" || owners[0].kind !== "Job" || owners[0].name !== name || owners[0].uid !== workloadUid || owners[0].controller !== true) throw new Error("refusing to register a Pod that differs from the assigned governed skill Job");
}

/** Create the least-privilege Kubernetes adapter owned only by the governed-skill controller. */
export function __CreateKubernetesSkillWorkloadControllerStore(options: SkillWorkloadControllerKubernetesStoreOptions): SkillWorkloadControllerKubernetesStore
{
	if (!Number.isSafeInteger(options.requestTimeoutMilliseconds) || options.requestTimeoutMilliseconds < 1_000 || options.requestTimeoutMilliseconds > 60_000) throw new Error("governed skill Kubernetes store requires a 1-60s request timeout");
	return {
		async __EnsureSuspendedJob(expected: V1Job): Promise<V1Job>
		{
			const { name, namespace } = _Coordinates(expected);
			try
			{
				const created = await options.batchApi.createNamespacedJob({ namespace, body: expected }, _RequestOptions(options.shutdownSignal, options.requestTimeoutMilliseconds));
				_AssertExactAssignedJob(created, expected, created.metadata?.uid ?? "");
				if (created.spec?.suspend !== true) throw new Error("Kubernetes did not create a suspended governed skill Job");
				return created;
			}
			catch (err)
			{
				if (_StatusCode(err) !== 409) throw err;
				const current = await options.batchApi.readNamespacedJob({ namespace, name }, _RequestOptions(options.shutdownSignal, options.requestTimeoutMilliseconds));
				if (current.spec?.suspend !== true || !isDeepStrictEqual(_NormalizedJob(current), _NormalizedJob(expected))) throw new Error("refusing to adopt a Job that differs from the claimed suspended governed skill workload");
				return current;
			}
		},
		async __EnsureSkillJobReleased(expected: V1Job, workloadUid: string, releaseExpiresAt: string): Promise<V1Job>
		{
			const { name, namespace } = _Coordinates(expected);
			return ___DoWithTrace("agent_controller.skill_job.release", { name, namespace, workloadUid }, async function _ReleaseSkillJob(): Promise<V1Job>
			{
				// 1. Re-read and prove ownership so a colliding name can never be unsuspended.
				const current = await options.batchApi.readNamespacedJob({ namespace, name }, _RequestOptions(options.shutdownSignal, options.requestTimeoutMilliseconds));
				_AssertExactAssignedJob(current, expected, workloadUid);
				if (current.spec?.suspend === false) return current;
				// 2. Derive a shorter deadline from the durable release claim before changing execution state.
				const activeDeadlineSeconds = _ReleaseDeadline(expected, releaseExpiresAt, options.requestTimeoutMilliseconds);
				const identity = _ReleaseIdentity(current);
				// 3. CAS UID, resource version, suspension and deadline to prevent a stale controller release.
				const currentDeadline = current.spec?.activeDeadlineSeconds;
				if (typeof currentDeadline !== "number" || !Number.isSafeInteger(currentDeadline)) throw new Error("assigned governed skill Job is missing its active deadline");
				const released = await options.batchApi.patchNamespacedJob({ name: identity.name, namespace: identity.namespace, body: [{ op: "test", path: "/metadata/uid", value: identity.uid }, { op: "test", path: "/metadata/resourceVersion", value: identity.resourceVersion }, { op: "test", path: "/spec/suspend", value: true }, { op: "test", path: "/spec/activeDeadlineSeconds", value: currentDeadline }, { op: "replace", path: "/spec/activeDeadlineSeconds", value: activeDeadlineSeconds }, { op: "replace", path: "/spec/suspend", value: false }] }, _RequestOptions(options.shutdownSignal, options.requestTimeoutMilliseconds));
				_AssertExactAssignedJob(released, expected, workloadUid);
				if (released.spec?.suspend !== false || released.spec.activeDeadlineSeconds !== activeDeadlineSeconds) throw new Error("Kubernetes did not release the exact governed skill Job with its claim-bounded lifetime");
				return released;
			});
		},
		async __FindFirstSkillWorkloadPod(expectedJob: V1Job, workloadUid: string, serviceAccountName: string): Promise<V1Pod | null>
		{
			const { name, namespace } = _Coordinates(expectedJob);
			const listed = await options.coreApi.listNamespacedPod({ namespace, labelSelector: `batch.kubernetes.io/controller-uid=${workloadUid},opencrane.ai/skill-workload=${name}` }, _RequestOptions(options.shutdownSignal, options.requestTimeoutMilliseconds));
			if (listed.items.length === 0) return null;
			if (listed.items.length !== 1) throw new Error("refusing to choose among multiple Pods for one governed skill Job");
			_AssertExactPod(listed.items[0], expectedJob, workloadUid, serviceAccountName);
			return listed.items[0];
		},
	};
}
