import type { V1Job, V1Pod } from "@kubernetes/client-node";
import { describe, expect, it, vi } from "vitest";

import { __CreateKubernetesGovernedJobControllerStore } from "../governed-job-controller";
import type { GovernedJobControllerBatchApi, GovernedJobControllerCoreApi } from "../governed-job-controller.types";

/** Returns one complete suspended Job owned by the test workload class. */
function _ExpectedJob(): V1Job
{
	const labels = { "app.kubernetes.io/name": "test-worker", "opencrane.ai/test-workload": "workload-a" };
	return { apiVersion: "batch/v1", kind: "Job", metadata: { name: "workload-a", namespace: "test-workloads", labels }, spec: { suspend: true, backoffLimit: 0, activeDeadlineSeconds: 300, template: { metadata: { labels }, spec: { restartPolicy: "Never", serviceAccountName: "test-worker", containers: [{ name: "worker", image: `example.test/worker@sha256:${"a".repeat(64)}` }] } } } };
}

/** Add the immutable server fields returned after Kubernetes creates a Job. */
function _PersistedJob(expected: V1Job): V1Job
{
	return { ...structuredClone(expected), metadata: { ...expected.metadata, uid: "job-uid-1", resourceVersion: "7" } };
}

/** Builds the exact first Pod Kubernetes generated for one Job. */
function _FirstPod(job: V1Job): V1Pod
{
	const name = job.metadata?.name ?? "";
	const uid = job.metadata?.uid ?? "";
	return { metadata: { name: `${name}-pod`, namespace: job.metadata?.namespace, uid: "pod-uid-1", labels: { ...job.spec?.template.metadata?.labels, "batch.kubernetes.io/controller-uid": uid, "batch.kubernetes.io/job-name": name, "controller-uid": uid, "job-name": name }, ownerReferences: [{ apiVersion: "batch/v1", kind: "Job", name, uid, controller: true }] }, spec: { serviceAccountName: "test-worker", containers: [] } };
}

/** Compose the shared store with focused fake Kubernetes clients. */
function _Store(batchApi: GovernedJobControllerBatchApi, coreApi: GovernedJobControllerCoreApi)
{
	return __CreateKubernetesGovernedJobControllerStore({ batchApi, coreApi, requestTimeoutMilliseconds: 1_000, shutdownSignal: new AbortController().signal, workloadLabelKey: "opencrane.ai/test-workload", releaseTraceName: "test_workload.release" });
}

describe("governed Kubernetes Job controller store", function _DescribeGovernedJobStore()
{
	it("creates an exact suspended Job and keeps its API-issued UID", async function _CreatesSuspendedJob()
	{
		const expected = _ExpectedJob();
		const created = _PersistedJob(expected);
		const createNamespacedJob = vi.fn().mockResolvedValue(created);
		const store = _Store({ createNamespacedJob, readNamespacedJob: vi.fn(), patchNamespacedJob: vi.fn(), deleteNamespacedJob: vi.fn() }, { listNamespacedPod: vi.fn() });

		await expect(store.ensureSuspendedJob(expected)).resolves.toEqual(created);
		expect(createNamespacedJob).toHaveBeenCalledWith({ namespace: "test-workloads", body: expected }, expect.any(Object));
	});

	it("adopts only an existing suspended Job whose complete owned manifest matches", async function _AdoptsExactJob()
	{
		const expected = _ExpectedJob();
		const current = _PersistedJob(expected);
		const createNamespacedJob = vi.fn().mockRejectedValue({ statusCode: 409 });
		const readNamespacedJob = vi.fn().mockResolvedValue(current);
		const store = _Store({ createNamespacedJob, readNamespacedJob, patchNamespacedJob: vi.fn(), deleteNamespacedJob: vi.fn() }, { listNamespacedPod: vi.fn() });

		await expect(store.ensureSuspendedJob(expected)).resolves.toEqual(current);
		readNamespacedJob.mockResolvedValue({ ...current, spec: { ...current.spec!, template: { ...current.spec!.template, spec: { ...current.spec!.template.spec!, containers: [{ name: "worker", image: `example.test/other@sha256:${"b".repeat(64)}` }] } } } });
		await expect(store.ensureSuspendedJob(expected)).rejects.toThrow(/differs/);
	});

	it("releases only the saved UID and resource version through one compare-and-swap", async function _ReleasesExactJob()
	{
		const expected = _ExpectedJob();
		const current = _PersistedJob(expected);
		const released = { ...current, spec: { ...current.spec!, suspend: false } };
		const patchNamespacedJob = vi.fn().mockResolvedValue(released);
		const store = _Store({ createNamespacedJob: vi.fn(), readNamespacedJob: vi.fn().mockResolvedValue(current), patchNamespacedJob, deleteNamespacedJob: vi.fn() }, { listNamespacedPod: vi.fn() });

		await expect(store.releaseJob(expected, "job-uid-1", "2999-01-01T00:00:00.000Z")).resolves.toEqual(released);
		expect(patchNamespacedJob).toHaveBeenCalledWith(expect.objectContaining({ body: expect.arrayContaining([{ op: "test", path: "/metadata/uid", value: "job-uid-1" }, { op: "test", path: "/metadata/resourceVersion", value: "7" }]) }), expect.any(Object));
	});

	it("returns only the single exact first Pod owned by the bound Job", async function _FindsExactPod()
	{
		const job = _PersistedJob(_ExpectedJob());
		const pod = _FirstPod(job);
		const listNamespacedPod = vi.fn().mockResolvedValue({ items: [pod] });
		const store = _Store({ createNamespacedJob: vi.fn(), readNamespacedJob: vi.fn(), patchNamespacedJob: vi.fn(), deleteNamespacedJob: vi.fn() }, { listNamespacedPod });

		await expect(store.findFirstPod(job, "job-uid-1", "test-worker")).resolves.toEqual(pod);
		expect(listNamespacedPod).toHaveBeenCalledWith(expect.objectContaining({ labelSelector: "batch.kubernetes.io/controller-uid=job-uid-1,opencrane.ai/test-workload=workload-a" }), expect.any(Object));
		listNamespacedPod.mockResolvedValue({ items: [pod, pod] });
		await expect(store.findFirstPod(job, "job-uid-1", "test-worker")).rejects.toThrow(/multiple Pods/);
	});

	it("deletes only the saved Job UID and treats an already missing Job as complete", async function _DeletesExactJob()
	{
		const deleteNamespacedJob = vi.fn().mockResolvedValueOnce({}).mockRejectedValueOnce({ statusCode: 404 });
		const store = _Store({ createNamespacedJob: vi.fn(), readNamespacedJob: vi.fn(), patchNamespacedJob: vi.fn(), deleteNamespacedJob }, { listNamespacedPod: vi.fn() });
		const expected = _ExpectedJob();

		await expect(store.deleteJob(expected, "job-uid-1")).resolves.toBeUndefined();
		await expect(store.deleteJob(expected, "job-uid-1")).resolves.toBeUndefined();

		expect(deleteNamespacedJob).toHaveBeenCalledWith({ namespace: "test-workloads", name: "workload-a", body: { preconditions: { uid: "job-uid-1" } } }, expect.any(Object));
	});
});
