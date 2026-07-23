import { HttpMethod, RequestContext, type ConfigurationOptions, type V1Job, type V1Pod, type V1Secret } from "@kubernetes/client-node";
import { afterEach, describe, expect, it, vi } from "vitest";

import { __BuildSuspendedAgentRuntimeJob } from "@opencrane/backend/agents/runtime/k8s-launcher";

import { __CreateKubernetesAgentControllerStore } from "../kubernetes-agent-controller-store.js";
import type { AgentControllerBatchApi, AgentControllerCoreApi, AgentControllerKubernetesStoreOptions } from "../agent-controller.types.js";

/** Add the production deadline policy and a live process signal to focused API fakes. */
function _StoreOptions(options: Pick<AgentControllerKubernetesStoreOptions, "batchApi" | "coreApi">, shutdownSignal: AbortSignal = new AbortController().signal): AgentControllerKubernetesStoreOptions
{
	return { ...options, requestTimeoutMilliseconds: 1_000, shutdownSignal };
}

/** Apply generated-client middleware and return the AbortSignal installed on the request. */
async function _RequestSignal(options: ConfigurationOptions | undefined): Promise<AbortSignal>
{
	const middleware = options?.middleware?.[0];
	if (!middleware) throw new Error("expected Kubernetes request middleware");
	const context = new RequestContext("https://kubernetes.invalid", HttpMethod.GET);
	const prepared = await middleware.pre(context).toPromise();
	const signal = prepared.getSignal();
	if (!signal) throw new Error("expected Kubernetes request AbortSignal");
	return signal;
}

/** Keep one fake Kubernetes exchange pending until its actual request signal aborts it. */
async function _HangUntilAborted(options: ConfigurationOptions | undefined, signals: AbortSignal[]): Promise<never>
{
	const signal = await _RequestSignal(options);
	signals.push(signal);
	return new Promise(function _pending(_resolve, reject)
	{
		function _Abort(): void { reject(signal.reason); }
		if (signal.aborted) _Abort();
		else signal.addEventListener("abort", _Abort, { once: true });
	});
}

/** Build one valid suspended attempt Job for adapter tests. */
function _Job(): V1Job
{
	return __BuildSuspendedAgentRuntimeJob(
		{ runId: "run-1", attempt: 1, agentServiceId: "service-1", agentRevisionId: "revision-1", siloId: "silo-1", namespace: "silo-a-runtime", bootstrapReference: "bootstrap-ref-1", litellmKeySecretName: "litellm-key-store-test" },
			{ image: "ghcr.io/elewa-git/opencrane-agent-runtime@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", imagePullPolicy: "IfNotPresent", runtimeStreamUrl: "http://opencrane-server.silo-a.svc.cluster.local:3001/api/internal/agent-runtime", litellmBaseUrl: "http://litellm.silo-a.svc.cluster.local:4000", serverNamespace: "silo-a", serviceAccountName: "agent-runtime-default", projectedTokenTtlSeconds: 600, scratchSize: "64Mi", activeDeadlineSeconds: 900, ttlSecondsAfterFinished: 0, resources: { requests: { cpu: "25m", memory: "64Mi" }, limits: { cpu: "250m", memory: "128Mi" } } },
	);
}

/** Return a Core API fake that reports no Pod and accepts Secret creation unless overridden. */
function _CoreApi(overrides: Partial<AgentControllerCoreApi> = {}): AgentControllerCoreApi
{
	return {
		async listNamespacedPod() { return { apiVersion: "v1", kind: "PodList", metadata: {}, items: [] }; },
		async createNamespacedSecret(request) { return request.body; },
		...overrides,
	};
}

/** Build one immutable, Job-owned attempt-key Secret for adapter tests. */
function _Secret(): V1Secret
{
	return { apiVersion: "v1", kind: "Secret", type: "Opaque", immutable: true, metadata: { name: "litellm-key-store-test", namespace: "silo-a-runtime", ownerReferences: [{ apiVersion: "batch/v1", kind: "Job", name: "agent-runtime-a1-x", uid: "job-uid", controller: true, blockOwnerDeletion: true }] }, stringData: { key: "sk-attempt-transient" } };
}

/** Return the exact Pod labels authored by the Job controller. */
function _PodLabels(job: V1Job, workloadUid: string): Record<string, string>
{
	return {
		...job.spec?.template.metadata?.labels,
		"batch.kubernetes.io/controller-uid": workloadUid,
		"batch.kubernetes.io/job-name": job.metadata!.name!,
		"controller-uid": workloadUid,
		"job-name": job.metadata!.name!,
	};
}

/** Build the unique exact first Pod owned by one assigned Job. */
function _Pod(job: V1Job, workloadUid = "job-uid"): V1Pod
{
	return {
		apiVersion: "v1",
		kind: "Pod",
		metadata: { name: "runtime-pod-1", namespace: job.metadata?.namespace, uid: "pod-uid", labels: _PodLabels(job, workloadUid), ownerReferences: [{ apiVersion: "batch/v1", kind: "Job", name: job.metadata!.name!, uid: workloadUid, controller: true }] },
		spec: { containers: [], serviceAccountName: "agent-runtime-default" },
	};
}

/** Return an AlreadyExists error in a Kubernetes-client-compatible shape. */
function _Conflict(): Error & { statusCode: number }
{
	return Object.assign(new Error("already exists"), { statusCode: 409 });
}

describe("least-privilege Kubernetes controller store", function _Suite()
{
	afterEach(function _RestoreMocks()
	{
		vi.restoreAllMocks();
	});

	it("creates the exact suspended Job without any update API", async function _Creates()
	{
		const job = _Job();
		const batchApi: AgentControllerBatchApi = { async createNamespacedJob() { return { ...job, metadata: { ...job.metadata, uid: "job-uid" } }; }, async readNamespacedJob() { throw new Error("unexpected read"); }, async patchNamespacedJob() { throw new Error("unexpected patch"); } };
		const store = __CreateKubernetesAgentControllerStore(_StoreOptions({ batchApi, coreApi: _CoreApi() }));

		expect((await store.__EnsureSuspendedJob(job)).metadata?.uid).toBe("job-uid");
	});

	it("creates the immutable attempt-key Secret with only the create verb", async function _CreatesSecret()
	{
		const secret = _Secret();
		let created: V1Secret | null = null;
		let listed = 0;
		const batchApi: AgentControllerBatchApi = { async createNamespacedJob() { throw new Error("unexpected Job"); }, async readNamespacedJob() { throw new Error("unexpected Job"); }, async patchNamespacedJob() { throw new Error("unexpected Job"); } };
		const coreApi = _CoreApi({ async createNamespacedSecret(request) { created = request.body; return request.body; }, async listNamespacedPod() { listed += 1; return { apiVersion: "v1", kind: "PodList", metadata: {}, items: [] }; } });
		const store = __CreateKubernetesAgentControllerStore(_StoreOptions({ batchApi, coreApi }));

		await store.__EnsureAttemptKeySecret(secret);

		expect((created as unknown as V1Secret)?.metadata?.name).toBe("litellm-key-store-test");
		expect((created as unknown as V1Secret)?.immutable).toBe(true);
		expect(listed).toBe(0);
	});

	it("treats an AlreadyExists attempt-key Secret as an idempotent success without any read", async function _AdoptsSecret()
	{
		const batchApi: AgentControllerBatchApi = { async createNamespacedJob() { throw new Error("unexpected Job"); }, async readNamespacedJob() { throw new Error("unexpected Job"); }, async patchNamespacedJob() { throw new Error("unexpected Job"); } };
		const coreApi = _CoreApi({ async createNamespacedSecret() { throw _Conflict(); } });
		const store = __CreateKubernetesAgentControllerStore(_StoreOptions({ batchApi, coreApi }));

		await expect(store.__EnsureAttemptKeySecret(_Secret())).resolves.toBeUndefined();
	});

	it("surfaces a non-conflict attempt-key Secret creation failure", async function _SecretFailure()
	{
		const batchApi: AgentControllerBatchApi = { async createNamespacedJob() { throw new Error("unexpected Job"); }, async readNamespacedJob() { throw new Error("unexpected Job"); }, async patchNamespacedJob() { throw new Error("unexpected Job"); } };
		const coreApi = _CoreApi({ async createNamespacedSecret() { throw Object.assign(new Error("forbidden"), { statusCode: 403 }); } });
		const store = __CreateKubernetesAgentControllerStore(_StoreOptions({ batchApi, coreApi }));

		await expect(store.__EnsureAttemptKeySecret(_Secret())).rejects.toThrow(/forbidden/);
	});

	it("exact-adopts the deterministic Job after a create conflict", async function _Adopts()
	{
		const job = _Job();
		const currentJob: V1Job = { ...job, metadata: { ...job.metadata, uid: "job-uid", resourceVersion: "4" } };
		const batchApi: AgentControllerBatchApi = { async createNamespacedJob() { throw _Conflict(); }, async readNamespacedJob() { return currentJob; }, async patchNamespacedJob() { throw new Error("unexpected patch"); } };
		const store = __CreateKubernetesAgentControllerStore(_StoreOptions({ batchApi, coreApi: _CoreApi() }));

		expect((await store.__EnsureSuspendedJob(job)).metadata?.uid).toBe("job-uid");
	});

	it("accepts only documented API defaults and an equal deprecated ServiceAccount alias", async function _NormalizesApiDefaults()
	{
		const job = _Job();
		const expectedPodSpec = job.spec?.template.spec;
		const currentJob: V1Job = {
			...job,
			metadata: { ...job.metadata, uid: "job-uid", resourceVersion: "4" },
			spec: {
				...job.spec!,
				manualSelector: false,
				completionMode: "NonIndexed",
				template: {
					...job.spec!.template,
					spec: {
						...expectedPodSpec!,
						serviceAccount: expectedPodSpec?.serviceAccountName,
						dnsPolicy: "ClusterFirst",
						schedulerName: "default-scheduler",
						terminationGracePeriodSeconds: expectedPodSpec?.terminationGracePeriodSeconds,
						containers: expectedPodSpec!.containers.map(function _container(container) { return { ...container, terminationMessagePath: "/dev/termination-log", terminationMessagePolicy: "File" }; }),
					},
				},
			},
		};
		const batchApi: AgentControllerBatchApi = { async createNamespacedJob() { throw _Conflict(); }, async readNamespacedJob() { return currentJob; }, async patchNamespacedJob() { throw new Error("unexpected patch"); } };
		const store = __CreateKubernetesAgentControllerStore(_StoreOptions({ batchApi, coreApi: _CoreApi() }));

		expect((await store.__EnsureSuspendedJob(job)).metadata?.uid).toBe("job-uid");
	});

	it("rejects a deprecated ServiceAccount alias that differs from the owned profile", async function _RejectsServiceAccountAliasDrift()
	{
		const job = _Job();
		const podSpec = job.spec?.template.spec;
		const currentJob: V1Job = { ...job, metadata: { ...job.metadata, uid: "job-uid" }, spec: { ...job.spec!, template: { ...job.spec!.template, spec: { ...podSpec!, serviceAccount: "foreign-controller" } } } };
		const batchApi: AgentControllerBatchApi = { async createNamespacedJob() { throw _Conflict(); }, async readNamespacedJob() { return currentJob; }, async patchNamespacedJob() { throw new Error("unexpected patch"); } };
		const store = __CreateKubernetesAgentControllerStore(_StoreOptions({ batchApi, coreApi: _CoreApi() }));

		await expect(store.__EnsureSuspendedJob(job)).rejects.toThrow(/refusing to adopt/);
	});

	it("refuses to adopt an executable Job", async function _RejectsDrift()
	{
		const job = _Job();
		const executableJob: V1Job = { ...job, metadata: { ...job.metadata, uid: "foreign-uid" }, spec: { ...job.spec!, suspend: false } };
		const batchApi: AgentControllerBatchApi = { async createNamespacedJob() { throw _Conflict(); }, async readNamespacedJob() { return executableJob; }, async patchNamespacedJob() { throw new Error("unexpected patch"); } };
		const store = __CreateKubernetesAgentControllerStore(_StoreOptions({ batchApi, coreApi: _CoreApi() }));

		await expect(store.__EnsureSuspendedJob(job)).rejects.toThrow(/refusing to adopt/);
	});

	it("releases only through the UID, resourceVersion, and suspend compare-and-swap patch", async function _ReleasesConditionally()
	{
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-07-20T00:20:00.000Z"));
		const job = _Job();
		const suspended: V1Job = { ...job, metadata: { ...job.metadata, uid: "job-uid", resourceVersion: "17" } };
		let patchRequest: Parameters<AgentControllerBatchApi["patchNamespacedJob"]>[0] | null = null;
		const batchApi: AgentControllerBatchApi = {
			async createNamespacedJob() { throw new Error("unexpected create"); },
			async readNamespacedJob() { return suspended; },
			async patchNamespacedJob(request) { patchRequest = request; return { ...suspended, metadata: { ...suspended.metadata, resourceVersion: "18" }, spec: { ...suspended.spec!, suspend: false, activeDeadlineSeconds: 268 } }; },
		};
		const store = __CreateKubernetesAgentControllerStore(_StoreOptions({ batchApi, coreApi: _CoreApi() }));

		expect((await store.__EnsureRuntimeJobReleased(job, "job-uid", "2026-07-20T00:25:00.000Z", "2026-07-20T00:20:30.000Z")).spec).toMatchObject({ suspend: false, activeDeadlineSeconds: 268 });
		expect(patchRequest).toEqual({
			name: job.metadata?.name,
			namespace: "silo-a-runtime",
			body: [
				{ op: "test", path: "/metadata/uid", value: "job-uid" },
					{ op: "test", path: "/metadata/resourceVersion", value: "17" },
					{ op: "test", path: "/spec/suspend", value: true },
					{ op: "test", path: "/spec/activeDeadlineSeconds", value: 900 },
					{ op: "replace", path: "/spec/activeDeadlineSeconds", value: 268 },
					{ op: "replace", path: "/spec/suspend", value: false },
			],
		});
	});

	it("exact-adopts a previously released Job without patching it again", async function _AdoptsReleasedJob()
	{
		const job = _Job();
		const released: V1Job = { ...job, metadata: { ...job.metadata, uid: "job-uid", resourceVersion: "18" }, spec: { ...job.spec!, suspend: false, activeDeadlineSeconds: 268 }, status: { startTime: new Date("2026-07-20T00:20:31.000Z") } };
		let patches = 0;
		const batchApi: AgentControllerBatchApi = { async createNamespacedJob() { throw new Error("unexpected create"); }, async readNamespacedJob() { return released; }, async patchNamespacedJob() { patches += 1; throw new Error("unexpected patch"); } };
		const store = __CreateKubernetesAgentControllerStore(_StoreOptions({ batchApi, coreApi: _CoreApi() }));

		expect(await store.__EnsureRuntimeJobReleased(job, "job-uid", "2026-07-20T00:25:00.000Z", "2026-07-20T00:21:00.000Z")).toEqual(released);
		expect(patches).toBe(0);
	});

	it("rejects release when the durable UID or complete Job contract differs", async function _RejectsReleaseDrift()
	{
		const job = _Job();
		const drifted: V1Job = { ...job, metadata: { ...job.metadata, uid: "foreign-uid", resourceVersion: "17" }, spec: { ...job.spec!, backoffLimit: 1 } };
		let patches = 0;
		const batchApi: AgentControllerBatchApi = { async createNamespacedJob() { throw new Error("unexpected create"); }, async readNamespacedJob() { return drifted; }, async patchNamespacedJob() { patches += 1; return drifted; } };
		const store = __CreateKubernetesAgentControllerStore(_StoreOptions({ batchApi, coreApi: _CoreApi() }));

		await expect(store.__EnsureRuntimeJobReleased(job, "job-uid", "2026-07-20T00:25:00.000Z", "2026-07-20T00:20:30.000Z")).rejects.toThrow(/exact durable workload assignment/);
		expect(patches).toBe(0);
	});

	it("rejects a patch response that does not carry the exact expiry-derived deadline", async function _RejectsPatchDeadlineDrift()
	{
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-07-20T00:20:00.000Z"));
		const job = _Job();
		const suspended: V1Job = { ...job, metadata: { ...job.metadata, uid: "job-uid", resourceVersion: "17" } };
		const batchApi: AgentControllerBatchApi = { async createNamespacedJob() { throw new Error("unexpected create"); }, async readNamespacedJob() { return suspended; }, async patchNamespacedJob() { return { ...suspended, spec: { ...suspended.spec!, suspend: false, activeDeadlineSeconds: 899 } }; } };
		const store = __CreateKubernetesAgentControllerStore(_StoreOptions({ batchApi, coreApi: _CoreApi() }));

		await expect(store.__EnsureRuntimeJobReleased(job, "job-uid", "2026-07-20T00:25:00.000Z", "2026-07-20T00:20:30.000Z")).rejects.toThrow(/unexpected assignment deadline/);
	});

	it("rejects a previously released Job whose start and deadline outlive assignment expiry", async function _RejectsReleasedExpiryDrift()
	{
		const job = _Job();
		const released: V1Job = { ...job, metadata: { ...job.metadata, uid: "job-uid", resourceVersion: "18" }, spec: { ...job.spec!, suspend: false, activeDeadlineSeconds: 300 }, status: { startTime: new Date("2026-07-20T00:20:31.000Z") } };
		const batchApi: AgentControllerBatchApi = { async createNamespacedJob() { throw new Error("unexpected create"); }, async readNamespacedJob() { return released; }, async patchNamespacedJob() { throw new Error("unexpected patch"); } };
		const store = __CreateKubernetesAgentControllerStore(_StoreOptions({ batchApi, coreApi: _CoreApi() }));

		await expect(store.__EnsureRuntimeJobReleased(job, "job-uid", "2026-07-20T00:25:00.000Z", "2026-07-20T00:21:00.000Z")).rejects.toThrow(/outlive its absolute assignment expiry/);
	});

	it("lists with both exact labels and returns the unique strictly owned first Pod", async function _FindsFirstPod()
	{
		const job = _Job();
		const pod = _Pod(job);
		let selector = "";
		const batchApi: AgentControllerBatchApi = { async createNamespacedJob() { throw new Error("unexpected Job"); }, async readNamespacedJob() { throw new Error("unexpected Job"); }, async patchNamespacedJob() { throw new Error("unexpected Job"); } };
		const coreApi = _CoreApi({ async listNamespacedPod(request) { selector = request.labelSelector; return { apiVersion: "v1", kind: "PodList", metadata: {}, items: [pod] }; } });
		const store = __CreateKubernetesAgentControllerStore(_StoreOptions({ batchApi, coreApi }));

		expect((await store.__FindFirstRuntimePod(job, "job-uid", "agent-runtime-default"))?.metadata?.uid).toBe("pod-uid");
		expect(selector).toBe(`batch.kubernetes.io/controller-uid=job-uid,opencrane.ai/runtime-attempt=${job.metadata?.name}`);
	});

	it("treats zero Pods as pending and rejects multiple or foreign candidates", async function _RejectsAmbiguousPods()
	{
		const job = _Job();
		const pod = _Pod(job);
		const batchApi: AgentControllerBatchApi = { async createNamespacedJob() { throw new Error("unexpected Job"); }, async readNamespacedJob() { throw new Error("unexpected Job"); }, async patchNamespacedJob() { throw new Error("unexpected Job"); } };
		const pending = __CreateKubernetesAgentControllerStore(_StoreOptions({ batchApi, coreApi: _CoreApi() }));
		const multiple = __CreateKubernetesAgentControllerStore(_StoreOptions({ batchApi, coreApi: _CoreApi({ async listNamespacedPod() { return { apiVersion: "v1", kind: "PodList", metadata: {}, items: [pod, { ...pod, metadata: { ...pod.metadata, uid: "pod-uid-2" } }] }; } }) }));
		const foreignPod: V1Pod = { ...pod, metadata: { ...pod.metadata, ownerReferences: [{ apiVersion: "batch/v1", kind: "Job", name: job.metadata!.name!, uid: "foreign-uid", controller: true }] } };
		const foreign = __CreateKubernetesAgentControllerStore(_StoreOptions({ batchApi, coreApi: _CoreApi({ async listNamespacedPod() { return { apiVersion: "v1", kind: "PodList", metadata: {}, items: [foreignPod] }; } }) }));

		expect(await pending.__FindFirstRuntimePod(job, "job-uid", "agent-runtime-default")).toBeNull();
		await expect(multiple.__FindFirstRuntimePod(job, "job-uid", "agent-runtime-default")).rejects.toThrow(/multiple Pods/);
		await expect(foreign.__FindFirstRuntimePod(job, "job-uid", "agent-runtime-default")).rejects.toThrow(/exact assigned Job owner/);
	});

	it("aborts a hung Kubernetes create through its per-call hard deadline", async function _AbortsOnDeadline()
	{
		const job = _Job();
		const deadline = new AbortController();
		const signals: AbortSignal[] = [];
		vi.spyOn(AbortSignal, "timeout").mockImplementation(function _Deadline(milliseconds)
		{
			expect(milliseconds).toBe(1_000);
			return deadline.signal;
		});
		const batchApi: AgentControllerBatchApi = { async createNamespacedJob(_request, requestOptions) { return _HangUntilAborted(requestOptions, signals); }, async readNamespacedJob() { throw new Error("unexpected Job"); }, async patchNamespacedJob() { throw new Error("unexpected Job"); } };
		const store = __CreateKubernetesAgentControllerStore(_StoreOptions({ batchApi, coreApi: _CoreApi() }));

		const pending = store.__EnsureSuspendedJob(job);
		await vi.waitFor(function _SignalInstalled() { expect(signals).toHaveLength(1); });
		const rejection = expect(pending).rejects.toMatchObject({ name: "TimeoutError" });
		deadline.abort(new DOMException("Kubernetes request deadline elapsed", "TimeoutError"));
		await rejection;
		expect(signals[0]?.aborted).toBe(true);
	});

	it("uses a fresh retry deadline and aborts the retry immediately on shutdown", async function _AbortsRetryOnShutdown()
	{
		const job = _Job();
		const shutdown = new AbortController();
		const deadlines: AbortController[] = [];
		const signals: AbortSignal[] = [];
		vi.spyOn(AbortSignal, "timeout").mockImplementation(function _Deadline()
		{
			const deadline = new AbortController();
			deadlines.push(deadline);
			return deadline.signal;
		});
		const batchApi: AgentControllerBatchApi = { async createNamespacedJob() { throw new Error("unexpected Job"); }, async readNamespacedJob() { throw new Error("unexpected Job"); }, async patchNamespacedJob() { throw new Error("unexpected Job"); } };
		const coreApi = _CoreApi({ async listNamespacedPod(_request, requestOptions) { return _HangUntilAborted(requestOptions, signals); } });
		const store = __CreateKubernetesAgentControllerStore(_StoreOptions({ batchApi, coreApi }, shutdown.signal));

		// 1. Let the first request reach its deadline so the reconciliation loop can retry.
		const first = store.__FindFirstRuntimePod(job, "job-uid", "agent-runtime-default");
		await vi.waitFor(function _FirstSignalInstalled() { expect(signals).toHaveLength(1); });
		const firstRejection = expect(first).rejects.toMatchObject({ name: "TimeoutError" });
		deadlines[0]?.abort(new DOMException("Kubernetes request deadline elapsed", "TimeoutError"));
		await firstRejection;

		// 2. Confirm the retry owns a new signal before process shutdown cancels it.
		const retry = store.__FindFirstRuntimePod(job, "job-uid", "agent-runtime-default");
		await vi.waitFor(function _RetrySignalInstalled() { expect(signals).toHaveLength(2); });
		expect(signals[1]).not.toBe(signals[0]);
		const retryRejection = expect(retry).rejects.toBe("SIGTERM");
		shutdown.abort("SIGTERM");
		await retryRejection;
		expect(deadlines).toHaveLength(2);
		expect(signals[1]?.aborted).toBe(true);
	});
});
