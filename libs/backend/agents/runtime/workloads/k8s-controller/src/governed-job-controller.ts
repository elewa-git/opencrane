import { isDeepStrictEqual } from "node:util";

import { Observable, type ConfigurationOptions, type ObservableMiddleware, type RequestContext, type ResponseContext, type V1Job, type V1ObjectMeta, type V1Pod } from "@kubernetes/client-node";

import { ___DoWithTrace } from "@opencrane/backend/observability";

import type { GovernedJobControllerStore, GovernedJobControllerStoreOptions, GovernedJobObservation } from "./governed-job-controller.types";

const _SERVER_METADATA_FIELDS = ["creationTimestamp", "generation", "managedFields", "resourceVersion", "selfLink", "uid"] as const;
/** Kubernetes owner-reference kind for one Batch Job. */
const _KUBERNETES_JOB_KIND = "Job";

/** Give one Kubernetes call a signal that fires on shutdown or request timeout. */
function _RequestOptions(shutdownSignal: AbortSignal, timeoutMilliseconds: number): ConfigurationOptions
{
	const signal = AbortSignal.any([shutdownSignal, AbortSignal.timeout(timeoutMilliseconds)]);
	const middleware: ObservableMiddleware = {
		pre(context: RequestContext): Observable<RequestContext> { context.setSignal(signal); return new Observable(Promise.resolve(context)); },
		post(context: ResponseContext): Observable<ResponseContext> { return new Observable(Promise.resolve(context)); },
	};
	return { middleware: [middleware], middlewareMergeStrategy: "append" };
}

/** Read the HTTP status out of a generated Kubernetes client error. */
function _StatusCode(error: unknown): number | undefined
{
	if (typeof error !== "object" || error === null)
		return undefined;
	const record = error as Record<string, unknown>;
	if (typeof record.statusCode === "number")
		return record.statusCode;
	if (typeof record.code === "number")
		return record.code;
	const body = typeof record.body === "object" && record.body !== null ? record.body as Record<string, unknown> : null;
	return typeof body?.code === "number" ? body.code : undefined;
}

/** Require deterministic namespaced Job coordinates before any Kubernetes call. */
function _Coordinates(job: V1Job): { readonly name: string; readonly namespace: string }
{
	const name = job.metadata?.name;
	const namespace = job.metadata?.namespace;
	if (!name || !namespace)
		throw new Error("governed Job requires deterministic namespaced metadata");
	return { name, namespace };
}

/** Remove only metadata fields that the Kubernetes API server owns. */
function _OwnedMetadata(metadata: V1ObjectMeta | undefined): V1ObjectMeta
{
	const owned = structuredClone(metadata ?? {});
	for (const field of _SERVER_METADATA_FIELDS) delete (owned as Record<string, unknown>)[field];
	return owned;
}

/** Remove documented Kubernetes defaults and generated Job selector labels before comparison. */
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
		if (!matchLabels || !labels || !isDeepStrictEqual(matchLabels, expected) || !Object.entries(expected).every(function _MatchesGenerated([key, value]): boolean { return labels[key] === value; }))
			throw new Error("refusing to adopt a governed Job with unexpected Kubernetes selectors");
		for (const key of Object.keys(expected)) delete labels[key];
		delete spec.selector;
	}
	if (spec.manualSelector === false)
		delete spec.manualSelector;
	if (spec.completionMode === "NonIndexed")
		delete spec.completionMode;
	const podSpec = ((spec.template as Record<string, unknown>).spec as Record<string, unknown>);
	if (podSpec.serviceAccount === podSpec.serviceAccountName)
		delete podSpec.serviceAccount;
	if (podSpec.dnsPolicy === "ClusterFirst")
		delete podSpec.dnsPolicy;
	if (podSpec.schedulerName === "default-scheduler")
		delete podSpec.schedulerName;
	if (podSpec.terminationGracePeriodSeconds === 30)
		delete podSpec.terminationGracePeriodSeconds;
	return normalized;
}

/** Require the saved UID and complete expected manifest before adopting or releasing a Job. */
function _AssertExactAssignedJob(current: V1Job, expected: V1Job, workloadUid: string): void
{
	if (current.metadata?.uid !== workloadUid || (current.spec?.suspend !== true && current.spec?.suspend !== false))
		throw new Error("refusing to adopt a Job outside the exact durable workload assignment");
	const comparable = structuredClone(expected);
	if (!comparable.spec)
		throw new Error("expected governed Job is missing a specification");
	const currentDeadline = current.spec?.activeDeadlineSeconds;
	const maximumDeadline = expected.spec?.activeDeadlineSeconds;
	comparable.spec.suspend = current.spec.suspend;
	if (current.spec.suspend === false)
	{
		if (typeof currentDeadline !== "number" || typeof maximumDeadline !== "number" || !Number.isSafeInteger(currentDeadline) || !Number.isSafeInteger(maximumDeadline) || currentDeadline < 1 || currentDeadline > maximumDeadline)
			throw new Error("released governed Job has an invalid bounded lifetime");
		comparable.spec.activeDeadlineSeconds = currentDeadline;
	}
	if (!isDeepStrictEqual(_NormalizedJob(current), _NormalizedJob(comparable)))
		throw new Error("refusing to adopt a Job that differs from the assigned governed workload");
}

/** Require the immutable Job coordinates used by the compare-and-swap release patch. */
function _ReleaseIdentity(job: V1Job): { readonly name: string; readonly namespace: string; readonly uid: string; readonly resourceVersion: string }
{
	const { name, namespace } = _Coordinates(job);
	const uid = job.metadata?.uid;
	const resourceVersion = job.metadata?.resourceVersion;
	if (!uid || !resourceVersion)
		throw new Error("assigned governed Job is missing UID or resourceVersion for release");
	return { name, namespace, uid, resourceVersion };
}

/** Bound the released Job lifetime to the remaining database-issued lease. */
function _ReleaseDeadline(expected: V1Job, releaseExpiresAt: string, requestTimeoutMilliseconds: number): number
{
	const expiry = Date.parse(releaseExpiresAt);
	const maximum = expected.spec?.activeDeadlineSeconds;
	const remaining = Math.floor((expiry - Date.now() - requestTimeoutMilliseconds) / 1_000);
	if (!Number.isSafeInteger(expiry) || !Number.isSafeInteger(maximum) || maximum === undefined || maximum < 1 || remaining < 1)
		throw new Error("governed workload lease expired before Kubernetes release");
	return Math.min(maximum, remaining);
}

/** Require the exact Job owner, ServiceAccount, namespace, labels, and immutable Pod UID. */
function _AssertExactPod(pod: V1Pod, expectedJob: V1Job, workloadUid: string, serviceAccountName: string): void
{
	const name = expectedJob.metadata?.name;
	const namespace = expectedJob.metadata?.namespace;
	const labels = expectedJob.spec?.template.metadata?.labels;
	const expectedLabels = { ...labels, "batch.kubernetes.io/controller-uid": workloadUid, "batch.kubernetes.io/job-name": name, "controller-uid": workloadUid, "job-name": name };
	const owners = pod.metadata?.ownerReferences ?? [];
	if (!name || !namespace || !pod.metadata?.uid || pod.metadata.namespace !== namespace || pod.spec?.serviceAccountName !== serviceAccountName || !isDeepStrictEqual(pod.metadata?.labels, expectedLabels) || owners.length !== 1 || owners[0]?.apiVersion !== "batch/v1" || owners[0].kind !== _KUBERNETES_JOB_KIND || owners[0].name !== name || owners[0].uid !== workloadUid || owners[0].controller !== true)
		throw new Error("refusing to register a Pod that differs from the assigned governed Job");
}

/** Map one exact released Job to the narrow recovery state its durable owner may consume. */
function _JobObservation(job: V1Job): GovernedJobObservation
{
	if (job.spec?.suspend !== false)
	{
		throw new Error("refusing to observe a governed Job that has not been released");
	}
	const terminalConditions = (job.status?.conditions ?? []).filter(function _TerminalCondition(condition): boolean
	{
		return condition.status === "True" && (condition.type === "Complete" || condition.type === "Failed");
	});
	if (terminalConditions.length > 1)
	{
		throw new Error("governed Job has ambiguous terminal conditions");
	}
	return terminalConditions.length === 1 ? "terminal" : "running";
}

/**
 * Creates the only shared implementation of exact governed Job adoption, release, and Pod lookup.
 *
 * Class-specific controllers still own their Job builders, labels, profiles, claims, and database
 * writes. This store accepts a complete expected manifest and never chooses an image or workload.
 * Called by: the governed skill adapter; the OCI MCP workflow controller will use the same seam
 * when that class-specific adapter is composed.
 *
 * @param options - Narrow Kubernetes clients, request deadline, shutdown signal, and code-owned label and trace names.
 * @returns A store that creates or adopts an exact suspended Job, releases its saved UID, and verifies its first Pod.
 * @throws When the timeout, label key, or trace name is not a bounded code-owned value.
 */
export function __CreateKubernetesGovernedJobControllerStore(options: GovernedJobControllerStoreOptions): GovernedJobControllerStore
{
	if (!Number.isSafeInteger(options.requestTimeoutMilliseconds) || options.requestTimeoutMilliseconds < 1_000 || options.requestTimeoutMilliseconds > 60_000 || !/^[a-z0-9]([-a-z0-9.]*[a-z0-9])?\/[a-z0-9]([-a-z0-9.]*[a-z0-9])?$/.test(options.workloadLabelKey) || !/^[a-z0-9_.]+$/.test(options.releaseTraceName))
		throw new Error("governed Job store requires a 1-60s timeout and bounded code-owned label and trace names");
	return {
		async ensureSuspendedJob(expected: V1Job): Promise<V1Job>
		{
			const { name, namespace } = _Coordinates(expected);
			try
			{
				const created = await options.batchApi.createNamespacedJob({ namespace, body: expected }, _RequestOptions(options.shutdownSignal, options.requestTimeoutMilliseconds));
				_AssertExactAssignedJob(created, expected, created.metadata?.uid ?? "");
				if (created.spec?.suspend !== true)
					throw new Error("Kubernetes did not create a suspended governed Job");
				return created;
			}
			catch (error)
			{
				if (_StatusCode(error) !== 409)
					throw error;
				const current = await options.batchApi.readNamespacedJob({ namespace, name }, _RequestOptions(options.shutdownSignal, options.requestTimeoutMilliseconds));
				if (current.spec?.suspend !== true || !isDeepStrictEqual(_NormalizedJob(current), _NormalizedJob(expected)))
					throw new Error("refusing to adopt a Job that differs from the claimed suspended governed workload");
				return current;
			}
		},
		async releaseJob(expected: V1Job, workloadUid: string, releaseExpiresAt: string): Promise<V1Job>
		{
			const { name, namespace } = _Coordinates(expected);
			return await ___DoWithTrace(options.releaseTraceName, { name, namespace, workloadUid }, async function _ReleaseJob(): Promise<V1Job>
			{
				const current = await options.batchApi.readNamespacedJob({ namespace, name }, _RequestOptions(options.shutdownSignal, options.requestTimeoutMilliseconds));
				_AssertExactAssignedJob(current, expected, workloadUid);
				if (current.spec?.suspend === false)
					return current;
				const activeDeadlineSeconds = _ReleaseDeadline(expected, releaseExpiresAt, options.requestTimeoutMilliseconds);
				const identity = _ReleaseIdentity(current);
				const currentDeadline = current.spec?.activeDeadlineSeconds;
				if (typeof currentDeadline !== "number" || !Number.isSafeInteger(currentDeadline))
					throw new Error("assigned governed Job is missing its active deadline");
				const released = await options.batchApi.patchNamespacedJob({ name: identity.name, namespace: identity.namespace, body: [{ op: "test", path: "/metadata/uid", value: identity.uid }, { op: "test", path: "/metadata/resourceVersion", value: identity.resourceVersion }, { op: "test", path: "/spec/suspend", value: true }, { op: "test", path: "/spec/activeDeadlineSeconds", value: currentDeadline }, { op: "replace", path: "/spec/activeDeadlineSeconds", value: activeDeadlineSeconds }, { op: "replace", path: "/spec/suspend", value: false }] }, _RequestOptions(options.shutdownSignal, options.requestTimeoutMilliseconds));
				_AssertExactAssignedJob(released, expected, workloadUid);
				if (released.spec?.suspend !== false || released.spec.activeDeadlineSeconds !== activeDeadlineSeconds)
					throw new Error("Kubernetes did not release the exact governed Job with its lease-bounded lifetime");
				return released;
			});
		},
		async findFirstPod(expectedJob: V1Job, workloadUid: string, serviceAccountName: string): Promise<V1Pod | null>
		{
			const { name, namespace } = _Coordinates(expectedJob);
			const listed = await options.coreApi.listNamespacedPod({ namespace, labelSelector: `batch.kubernetes.io/controller-uid=${workloadUid},${options.workloadLabelKey}=${name}` }, _RequestOptions(options.shutdownSignal, options.requestTimeoutMilliseconds));
			if (listed.items.length === 0)
				return null;
			if (listed.items.length !== 1)
				throw new Error("refusing to choose among multiple Pods for one governed Job");
			_AssertExactPod(listed.items[0], expectedJob, workloadUid, serviceAccountName);
			return listed.items[0];
		},
		async observeJob(expectedJob: V1Job, workloadUid: string): Promise<GovernedJobObservation>
		{
			const { name, namespace } = _Coordinates(expectedJob);
			try
			{
				const current = await options.batchApi.readNamespacedJob({ namespace, name }, _RequestOptions(options.shutdownSignal, options.requestTimeoutMilliseconds));
				_AssertExactAssignedJob(current, expectedJob, workloadUid);
				return _JobObservation(current);
			}
			catch (error)
			{
				if (_StatusCode(error) === 404)
				{
					return "missing";
				}
				throw error;
			}
		},
		async deleteJob(expectedJob: V1Job, workloadUid: string): Promise<void>
		{
			const { name, namespace } = _Coordinates(expectedJob);
			await ___DoWithTrace(`${options.releaseTraceName}.delete`, { name, namespace, workloadUid }, async function _DeleteJob(): Promise<void>
			{
				try
				{
					await options.batchApi.deleteNamespacedJob({ namespace, name, body: { preconditions: { uid: workloadUid } } }, _RequestOptions(options.shutdownSignal, options.requestTimeoutMilliseconds));
				}
				catch (error)
				{
					if (_StatusCode(error) === 404)
						return;
					throw error;
				}
			});
		},
	};
}
