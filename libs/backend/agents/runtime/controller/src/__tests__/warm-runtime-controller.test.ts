import type { V1Deployment, V1Pod, V1ReplicaSet } from "@kubernetes/client-node";
import { describe, expect, it, vi } from "vitest";

import type { WarmRuntimePoolProfile } from "@opencrane/backend/agents/runtime/k8s-launcher";

import { __CreateWarmRuntimeKubernetesStore } from "../warm-runtime-controller";
import type { WarmRuntimeKubernetesStoreOptions } from "../warm-runtime-controller.types";

/** Returns the fixed pool profile used by the Kubernetes adapter tests. */
function _Profile(): WarmRuntimePoolProfile
{
	return { namespace: "opencrane-runtime", deploymentName: "personal-warm", serviceAccountName: "warm-runtime", genericProfile: "generic", claimedProfile: "personal", image: `ghcr.io/elewa/opencrane-agent-runtime@sha256:${"a".repeat(64)}`, imagePullPolicy: "IfNotPresent", bindingPort: 8090, genericIdleSeconds: 900, scratchSize: "1Gi", resources: { requests: { cpu: "100m", memory: "128Mi" }, limits: { cpu: "1", memory: "1Gi" } } };
}

/** Returns the Helm-owned Deployment. */
function _Deployment(): V1Deployment
{
	return { metadata: { name: "personal-warm", namespace: "opencrane-runtime", uid: "deployment-uid", labels: { "opencrane.ai/warm-runtime-pool": "personal-warm" } } };
}

/** Returns a ReplicaSet controlled by the Helm-owned Deployment. */
function _ReplicaSet(): V1ReplicaSet
{
	return { metadata: { name: "personal-warm-aaa", namespace: "opencrane-runtime", uid: "rs-uid", ownerReferences: [{ apiVersion: "apps/v1", kind: "Deployment", name: "personal-warm", uid: "deployment-uid", controller: true }] } };
}

/** Returns a generic or claimed Pod from the pool. */
function _Pod(profile = "generic", resourceVersion = "12"): V1Pod
{
	return { metadata: { name: "personal-warm-abc", namespace: "opencrane-runtime", uid: "pod-uid", resourceVersion, labels: { "opencrane.ai/warm-runtime-pool": "personal-warm", "opencrane.ai/warm-runtime-profile": profile }, ownerReferences: [{ apiVersion: "apps/v1", kind: "ReplicaSet", name: "personal-warm-aaa", uid: "rs-uid", controller: true }] }, spec: { serviceAccountName: "warm-runtime", containers: [] }, status: { phase: "Running", podIP: "10.42.0.10" } };
}

/** Creates narrow fake clients for one complete claim lifecycle. */
function _Options(): WarmRuntimeKubernetesStoreOptions
{
	return {
		appsApi: { readNamespacedDeployment: vi.fn().mockResolvedValue(_Deployment()), listNamespacedReplicaSet: vi.fn().mockResolvedValue({ items: [_ReplicaSet()] }) },
		coreApi: { listNamespacedPod: vi.fn().mockResolvedValue({ items: [_Pod()] }), readNamespacedPod: vi.fn().mockResolvedValue(_Pod()), patchNamespacedPod: vi.fn().mockResolvedValue(_Pod("personal", "13")), deleteNamespacedPod: vi.fn().mockResolvedValue(_Pod("personal", "13")) },
		requestTimeoutMilliseconds: 1_000,
		shutdownSignal: new AbortController().signal,
		fetch: vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
	};
}

describe("warm runtime Kubernetes controller", function _WarmRuntimeKubernetesController()
{
	it("lists, conditionally activates, probes, and UID-deletes one Pod", async function _RunsLifecycle()
	{
		const options = _Options();
		const store = __CreateWarmRuntimeKubernetesStore(options);
		const candidate = (await store.listGenericPods(_Profile()))[0];
		const activation = await store.activateProfile(candidate, _Profile());
		await expect(store.proveReadiness(candidate, activation, _Profile())).resolves.toEqual(expect.objectContaining({ podUid: "pod-uid", profile: "personal" }));
		(options.coreApi.readNamespacedPod as ReturnType<typeof vi.fn>).mockResolvedValue(_Pod("personal", "13"));
		await store.deletePod({ namespace: "opencrane-runtime", podName: "personal-warm-abc", podUid: "pod-uid", deploymentUid: "deployment-uid", profile: "personal" }, _Profile());
		expect(options.coreApi.patchNamespacedPod).toHaveBeenCalledWith(expect.objectContaining({ body: [
			{ op: "test", path: "/metadata/uid", value: "pod-uid" },
			{ op: "test", path: "/metadata/resourceVersion", value: "12" },
			{ op: "test", path: "/metadata/labels/opencrane.ai~1warm-runtime-profile", value: "generic" },
			{ op: "replace", path: "/metadata/labels/opencrane.ai~1warm-runtime-profile", value: "personal" },
		] }), expect.anything());
		expect(options.coreApi.deleteNamespacedPod).toHaveBeenCalledWith(expect.objectContaining({ body: expect.objectContaining({ preconditions: { uid: "pod-uid" } }) }), expect.anything());
	});

	it("refuses deletion after the Deployment UID changes", async function _RejectsReplacementOwner()
	{
		const options = _Options();
		(options.appsApi.readNamespacedDeployment as ReturnType<typeof vi.fn>).mockResolvedValue({ ..._Deployment(), metadata: { ..._Deployment().metadata, uid: "replacement-deployment" } });
		const store = __CreateWarmRuntimeKubernetesStore(options);
		await expect(store.deletePod({ namespace: "opencrane-runtime", podName: "personal-warm-abc", podUid: "pod-uid", deploymentUid: "deployment-uid", profile: "generic" }, _Profile())).rejects.toThrow(/different identity or ownership/);
		expect(options.coreApi.deleteNamespacedPod).not.toHaveBeenCalled();
	});
});
