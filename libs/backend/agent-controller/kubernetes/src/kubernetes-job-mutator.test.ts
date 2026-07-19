import { describe, expect, it, vi } from "vitest";

import type { AgentJobProjection } from "@opencrane/backend/agent-controller";

import { _KubernetesAgentJobMutator } from "./kubernetes-job-mutator.js";

/** Construct one controller-approved Kubernetes Job projection. */
function _Projection(): AgentJobProjection
{
	return { name: "agent-run-run-123-a1", labels: { "opencrane.io/run-id": "run-123" }, namespace: "opencrane-runtime", serviceAccountName: "agent-runtime", image: "ghcr.io/opencrane/agent-runtime@sha256:abc", suspend: true, backoffLimit: 0 };
}

/** Constructs a Kubernetes Job response with immutable identity. */
function _Job(uid = "job-uid", suspended = true)
{
	return { metadata: { name: "agent-run-run-123-a1", uid, labels: { "opencrane.io/run-id": "run-123" } }, spec: { suspend: suspended } };
}

/** Constructs bounded fake Kubernetes APIs for adapter contract tests. */
function _Apis()
{
	return {
		batchApi: { readNamespacedJob: vi.fn(), createNamespacedJob: vi.fn(), deleteNamespacedJob: vi.fn(), patchNamespacedJob: vi.fn() },
		coreApi: { listNamespacedPod: vi.fn() },
	};
}

describe("Kubernetes agent Job mutator", function _describeJobMutator()
{
	it("maps an absent Job to null without suppressing other API failures", async function _mapsNotFound()
	{
		const apis = _Apis();
		apis.batchApi.readNamespacedJob.mockRejectedValueOnce({ code: 404 }).mockRejectedValueOnce({ code: 500 });
		const mutator = new _KubernetesAgentJobMutator(apis.batchApi as never, apis.coreApi as never);

		await expect(mutator.get(_Projection())).resolves.toBeNull();
		await expect(mutator.get(_Projection())).rejects.toEqual({ code: 500 });
	});

	it("creates only a suspended, non-retrying Job without a Kubernetes token", async function _createsBoundedJob()
	{
		const apis = _Apis();
		apis.batchApi.createNamespacedJob.mockResolvedValue(_Job());
		const mutator = new _KubernetesAgentJobMutator(apis.batchApi as never, apis.coreApi as never);

		await expect(mutator.createSuspended(_Projection())).resolves.toMatchObject({ uid: "job-uid", suspended: true });
		expect(apis.batchApi.createNamespacedJob).toHaveBeenCalledWith({ namespace: "opencrane-runtime", body: expect.objectContaining({ metadata: { name: "agent-run-run-123-a1", labels: { "opencrane.io/run-id": "run-123" } }, spec: expect.objectContaining({ suspend: true, backoffLimit: 0, template: expect.objectContaining({ spec: expect.objectContaining({ serviceAccountName: "agent-runtime", automountServiceAccountToken: false, restartPolicy: "Never" }) }) }) }) });
	});

	it("uses observed UID preconditions when deleting or unsuspending a Job", async function _usesUidPreconditions()
	{
		const apis = _Apis();
		apis.batchApi.deleteNamespacedJob.mockResolvedValue({});
		apis.batchApi.patchNamespacedJob.mockResolvedValue({});
		const mutator = new _KubernetesAgentJobMutator(apis.batchApi as never, apis.coreApi as never);

		await mutator.delete(_Projection(), "job-uid");
		await mutator.unsuspend(_Projection(), "job-uid");

		expect(apis.batchApi.deleteNamespacedJob).toHaveBeenCalledWith({ namespace: "opencrane-runtime", name: "agent-run-run-123-a1", body: { preconditions: { uid: "job-uid" } } });
		expect(apis.batchApi.patchNamespacedJob).toHaveBeenCalledWith({ namespace: "opencrane-runtime", name: "agent-run-run-123-a1", body: { metadata: { uid: "job-uid" }, spec: { suspend: false } } });
	});

	it("reports only a Pod controlled by the exact acknowledged Job UID", async function _filtersPodOwnership()
	{
		const apis = _Apis();
		apis.coreApi.listNamespacedPod.mockResolvedValue({ items: [
			{ metadata: { uid: "wrong-owner", ownerReferences: [{ uid: "other-job", controller: true }] } },
			{ metadata: { uid: "not-controller", ownerReferences: [{ uid: "job-uid", controller: false }] } },
			{ metadata: { uid: "pod-uid", ownerReferences: [{ uid: "job-uid", controller: true }] } },
		] });
		const mutator = new _KubernetesAgentJobMutator(apis.batchApi as never, apis.coreApi as never);

		await expect(mutator.firstPodUid(_Projection(), "job-uid")).resolves.toBe("pod-uid");
		expect(apis.coreApi.listNamespacedPod).toHaveBeenCalledWith({ namespace: "opencrane-runtime", labelSelector: "job-name=agent-run-run-123-a1" });
	});
});
