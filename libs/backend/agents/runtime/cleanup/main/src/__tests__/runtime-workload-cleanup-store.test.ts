import type { ConfigurationOptions, V1Job } from "@kubernetes/client-node";
import { describe, expect, it, vi } from "vitest";

import { __AgentRuntimeAttemptResourceName } from "@opencrane/backend/agents/runtime/k8s-launcher";

import { __CreateKubernetesRuntimeWorkloadCleanupStore } from "../runtime-workload-cleanup-store";
import type { KubernetesRuntimeWorkloadCleanupBatchApi, KubernetesRuntimeWorkloadCleanupProjection, KubernetesRuntimeWorkloadCleanupStore } from "../runtime-workload-cleanup-store.types";

/** Build the cleanup input these adapter tests share, with optional field overrides. */
function _Projection(overrides: Partial<KubernetesRuntimeWorkloadCleanupProjection> = {}): KubernetesRuntimeWorkloadCleanupProjection
{
	return {
		runId: "run-1",
		attempt: 3,
		siloId: "silo-1",
		agentServiceId: "service-1",
		agentRevisionId: "revision-1",
		namespace: "runtime-personal",
		bootstrapReference: "bootstrap-1",
		workloadUid: "job-uid-1",
		mode: "assigned",
		...overrides,
	};
}

/** Build a Job carrying the same labels and annotations the runtime Job launcher would write. */
function _Job(workload: KubernetesRuntimeWorkloadCleanupProjection, overrides: Partial<V1Job> = {}): V1Job
{
	const name = __AgentRuntimeAttemptResourceName(workload.siloId, workload.runId, workload.attempt);
	const authority = {
		"opencrane.ai/run-id": workload.runId,
		"opencrane.ai/run-attempt": String(workload.attempt),
		"opencrane.ai/agent-service-id": workload.agentServiceId,
		"opencrane.ai/agent-revision-id": workload.agentRevisionId,
		"opencrane.ai/silo-id": workload.siloId,
	};
	const labels = { "app.kubernetes.io/name": "opencrane-agent-runtime", "app.kubernetes.io/component": "agent-runtime", "opencrane.ai/runtime-attempt": name };
	return {
		apiVersion: "batch/v1",
		kind: "Job",
		metadata: { name, namespace: workload.namespace, uid: "job-uid-1", labels, annotations: authority },
		spec: { suspend: true, template: { metadata: { labels, annotations: { ...authority, "opencrane.ai/bootstrap-reference": workload.bootstrapReference } }, spec: { containers: [] } } },
		...overrides,
	};
}

/** Build a Batch API fake whose read and delete calls can each be checked separately. */
function _BatchApi(job: V1Job): KubernetesRuntimeWorkloadCleanupBatchApi
{
	return {
		readNamespacedJob: vi.fn().mockResolvedValue(job),
		deleteNamespacedJob: vi.fn().mockResolvedValue({}),
	};
}

/** Create the adapter with the same timeout and shutdown signal the real process gives it. */
function _Store(batchApi: KubernetesRuntimeWorkloadCleanupBatchApi, shutdownSignal: AbortSignal = new AbortController().signal, requestTimeoutMilliseconds = 5_000): KubernetesRuntimeWorkloadCleanupStore
{
	return __CreateKubernetesRuntimeWorkloadCleanupStore({ batchApi, requestTimeoutMilliseconds, shutdownSignal });
}

/** Read the AbortSignal installed by one generated-client middleware option. */
function _RequestSignal(options: ConfigurationOptions | undefined): AbortSignal
{
	let signal: AbortSignal | null = null;
	options?.middleware?.[0]?.pre({ setSignal(next: AbortSignal) { signal = next; } } as never);
	if (signal === null) throw new Error("request middleware did not install an AbortSignal");
	return signal;
}

describe("__CreateKubernetesRuntimeWorkloadCleanupStore", function _suite()
{
	it("returns authoritative absence without requesting deletion", async function _test()
	{
		const batchApi = _BatchApi(_Job(_Projection()));
		vi.mocked(batchApi.readNamespacedJob).mockRejectedValue({ statusCode: 404 });
		const store = _Store(batchApi);

		await expect(store.deleteExactProjection(_Projection())).resolves.toEqual({ status: "absent" });
		expect(batchApi.deleteNamespacedJob).not.toHaveBeenCalled();
	});

	it("deletes the exact projection with the API UID as a precondition", async function _test()
	{
		const workload = _Projection();
		const batchApi = _BatchApi(_Job(workload));
		const store = _Store(batchApi);
		const name = __AgentRuntimeAttemptResourceName(workload.siloId, workload.runId, workload.attempt);

		await expect(store.deleteExactProjection(workload)).resolves.toEqual({ status: "deletion_requested", workloadUid: "job-uid-1" });
		expect(batchApi.deleteNamespacedJob).toHaveBeenCalledWith({ namespace: "runtime-personal", name, body: { preconditions: { uid: "job-uid-1" } } }, expect.objectContaining({ middleware: expect.any(Array) }));
	});

	it("refuses a Job whose authority projection differs from the cleanup claim", async function _test()
	{
		const workload = _Projection();
		const foreign = _Job(workload);
		foreign.spec!.template.metadata!.annotations!["opencrane.ai/agent-service-id"] = "foreign-service";
		const batchApi = _BatchApi(foreign);
		const store = _Store(batchApi);

		await expect(store.deleteExactProjection(workload)).rejects.toThrow("outside the fenced cleanup projection");
		expect(batchApi.deleteNamespacedJob).not.toHaveBeenCalled();
	});

	it("refuses UID reuse and an executable unassigned orphan", async function _test()
	{
		const assigned = _Projection();
		const reusedApi = _BatchApi(_Job(assigned, { metadata: { ..._Job(assigned).metadata, uid: "job-uid-2" } }));
		await expect(_Store(reusedApi).deleteExactProjection(assigned)).rejects.toThrow("durable UID differs");

		const orphan = _Projection({ workloadUid: null, mode: "unassigned_orphan" });
		const executableJob = _Job(orphan);
		executableJob.spec!.suspend = false;
		const executableApi = _BatchApi(executableJob);
		await expect(_Store(executableApi).deleteExactProjection(orphan)).rejects.toThrow("not suspended");
		expect(executableApi.deleteNamespacedJob).not.toHaveBeenCalled();
	});

	it("attaches a bounded abortable request policy to every Kubernetes operation", async function _test()
	{
		const workload = _Projection();
		const batchApi = _BatchApi(_Job(workload));
		const shutdown = new AbortController();
		await _Store(batchApi, shutdown.signal).deleteExactProjection(workload);

		const readOptions = vi.mocked(batchApi.readNamespacedJob).mock.calls[0]?.[1];
		const deleteOptions = vi.mocked(batchApi.deleteNamespacedJob).mock.calls[0]?.[1];
		expect(readOptions).not.toBe(deleteOptions);
		expect(readOptions).toMatchObject({ middlewareMergeStrategy: "append" });
		expect(readOptions?.middleware).toHaveLength(1);
	});

	it("starts a fresh deadline for a reconciliation long after store construction", async function _test()
	{
		const workload = _Projection();
		const batchApi = _BatchApi(_Job(workload));
		const store = _Store(batchApi, new AbortController().signal, 1);
		await new Promise(function _wait(resolve) { setTimeout(resolve, 10); });

		await store.deleteExactProjection(workload);

		const readOptions = vi.mocked(batchApi.readNamespacedJob).mock.calls[0]?.[1];
		const deleteOptions = vi.mocked(batchApi.deleteNamespacedJob).mock.calls[0]?.[1];
		expect(_RequestSignal(readOptions).aborted).toBe(false);
		expect(_RequestSignal(deleteOptions).aborted).toBe(false);
	});
});
