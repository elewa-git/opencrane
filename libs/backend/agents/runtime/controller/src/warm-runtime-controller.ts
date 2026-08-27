import { Observable, type ConfigurationOptions, type ObservableMiddleware, type RequestContext, type ResponseContext, type V1Deployment, type V1Pod, type V1ReplicaSet } from "@kubernetes/client-node";

import { __WarmRuntimeGenericPodSelector, __WarmRuntimePodCandidate, __WARM_RUNTIME_POOL_LABEL, __WARM_RUNTIME_PROFILE_LABEL, type WarmRuntimePodCandidate, type WarmRuntimePodIdentity, type WarmRuntimePoolProfile } from "@opencrane/backend/agents/runtime/k8s-launcher";
import { ___DoWithTrace } from "@opencrane/backend/observability";

import type { WarmRuntimeKubernetesStore, WarmRuntimeKubernetesStoreOptions, WarmRuntimePodPatchOperation, WarmRuntimeProfileActivation, WarmRuntimeReadinessEvidence } from "./warm-runtime-controller.types";

/** Combines shutdown with one fixed request deadline. */
function _RequestOptions(options: WarmRuntimeKubernetesStoreOptions): ConfigurationOptions
{
	const signal = AbortSignal.any([options.shutdownSignal, AbortSignal.timeout(options.requestTimeoutMilliseconds)]);
	const middleware: ObservableMiddleware = {
		pre(context: RequestContext): Observable<RequestContext> { context.setSignal(signal); return new Observable(Promise.resolve(context)); },
		post(context: ResponseContext): Observable<ResponseContext> { return new Observable(Promise.resolve(context)); },
	};
	return { middleware: [middleware], middlewareMergeStrategy: "append" };
}

/** Returns a Deployment UID after checking the configured name and namespace. */
function _DeploymentUid(deployment: V1Deployment, profile: WarmRuntimePoolProfile): string
{
	const uid = deployment.metadata?.uid;
	if (!uid || deployment.metadata?.name !== profile.deploymentName || deployment.metadata.namespace !== profile.namespace || deployment.metadata.labels?.[__WARM_RUNTIME_POOL_LABEL] !== profile.deploymentName)
	{
		throw new Error("warm runtime Deployment does not match its configured pool");
	}
	return uid;
}

/** Returns ReplicaSet UIDs controlled by the exact pool Deployment. */
function _ReplicaSetUids(items: readonly V1ReplicaSet[], deploymentUid: string): ReadonlySet<string>
{
	const uids = new Set<string>();
	for (const item of items)
	{
		const owner = item.metadata?.ownerReferences?.find(function _ControllerOwner(reference) { return reference.controller === true; });
		if (item.metadata?.uid && owner?.apiVersion === "apps/v1" && owner.kind === "Deployment" && owner.uid === deploymentUid)
		{
			uids.add(item.metadata.uid);
		}
	}
	return uids;
}

/** Builds a conditional profile-label patch for one database-reserved Pod. */
function _ProfilePatch(candidate: WarmRuntimePodCandidate, profile: WarmRuntimePoolProfile): readonly WarmRuntimePodPatchOperation[]
{
	return [
		{ op: "test", path: "/metadata/uid", value: candidate.podUid },
		{ op: "test", path: "/metadata/resourceVersion", value: candidate.resourceVersion },
		{ op: "test", path: "/metadata/labels/opencrane.ai~1warm-runtime-profile", value: profile.genericProfile },
		{ op: "replace", path: "/metadata/labels/opencrane.ai~1warm-runtime-profile", value: profile.claimedProfile },
	];
}

/** Checks the Pod identity and profile returned after activation. */
function _Activation(pod: V1Pod, candidate: WarmRuntimePodCandidate, profile: WarmRuntimePoolProfile): WarmRuntimeProfileActivation
{
	const resourceVersion = pod.metadata?.resourceVersion;
	if (!resourceVersion || pod.metadata?.uid !== candidate.podUid || pod.metadata.namespace !== profile.namespace || pod.metadata.labels?.[__WARM_RUNTIME_PROFILE_LABEL] !== profile.claimedProfile)
	{
		throw new Error("Kubernetes did not activate the reserved warm runtime Pod");
	}
	return { podUid: candidate.podUid, resourceVersion, profile: profile.claimedProfile };
}

/** Loads the owner chain used by candidate and deletion checks. */
async function _PoolOwners(pool: WarmRuntimePoolProfile, options: WarmRuntimeKubernetesStoreOptions): Promise<{ readonly deploymentUid: string; readonly replicaSetUids: ReadonlySet<string> }>
{
	const requestOptions = _RequestOptions(options);
	const deployment = await options.appsApi.readNamespacedDeployment({ namespace: pool.namespace, name: pool.deploymentName }, requestOptions);
	const deploymentUid = _DeploymentUid(deployment, pool);
	const replicaSets = await options.appsApi.listNamespacedReplicaSet({ namespace: pool.namespace, labelSelector: `${__WARM_RUNTIME_POOL_LABEL}=${pool.deploymentName}` }, requestOptions);
	return { deploymentUid, replicaSetUids: _ReplicaSetUids(replicaSets.items, deploymentUid) };
}

/** Checks the Pod identity and owner chain before a delete request. */
async function _AssertDeletable(identity: WarmRuntimePodIdentity, pool: WarmRuntimePoolProfile, options: WarmRuntimeKubernetesStoreOptions): Promise<void>
{
	const owners = await _PoolOwners(pool, options);
	const pod = await options.coreApi.readNamespacedPod({ namespace: identity.namespace, name: identity.podName }, _RequestOptions(options));
	const owner = pod.metadata?.ownerReferences?.find(function _ControllerOwner(reference) { return reference.controller === true; });
	if (owners.deploymentUid !== identity.deploymentUid || pod.metadata?.uid !== identity.podUid || pod.metadata.namespace !== pool.namespace || pod.metadata.labels?.[__WARM_RUNTIME_POOL_LABEL] !== pool.deploymentName || pod.metadata.labels?.[__WARM_RUNTIME_PROFILE_LABEL] !== identity.profile || !owner?.uid || !owners.replicaSetUids.has(owner.uid))
	{
		throw new Error("refusing to delete a warm runtime Pod with different identity or ownership");
	}
}

/** Creates the sole Kubernetes adapter for the claimed warm runtime pool. */
export function __CreateWarmRuntimeKubernetesStore(options: WarmRuntimeKubernetesStoreOptions): WarmRuntimeKubernetesStore
{
	if (!Number.isSafeInteger(options.requestTimeoutMilliseconds) || options.requestTimeoutMilliseconds < 250 || options.requestTimeoutMilliseconds > 60_000)
	{
		throw new Error("warm runtime Kubernetes requests require a 250ms to 60s timeout");
	}
	const fetchRequest = options.fetch ?? fetch;
	return {
		async listGenericPods(profile): Promise<readonly WarmRuntimePodCandidate[]>
		{
			return await ___DoWithTrace("agent_controller.warm_runtime.list_generic", { namespace: profile.namespace, deploymentName: profile.deploymentName }, async function _ListCandidates(): Promise<readonly WarmRuntimePodCandidate[]>
			{
				const owners = await _PoolOwners(profile, options);
				const pods = await options.coreApi.listNamespacedPod({ namespace: profile.namespace, labelSelector: __WarmRuntimeGenericPodSelector(profile) }, _RequestOptions(options));
				return pods.items.map(function _Candidate(pod) { return __WarmRuntimePodCandidate(pod, profile, owners.deploymentUid, owners.replicaSetUids); });
			});
		},
		async activateProfile(candidate, profile): Promise<WarmRuntimeProfileActivation>
		{
			return await ___DoWithTrace("agent_controller.warm_runtime.activate_profile", { namespace: profile.namespace, podUid: candidate.podUid, profile: profile.claimedProfile }, async function _Activate(): Promise<WarmRuntimeProfileActivation>
			{
				const current = await options.coreApi.readNamespacedPod({ namespace: profile.namespace, name: candidate.podName }, _RequestOptions(options));
				if (current.metadata?.uid === candidate.podUid && current.metadata.labels?.[__WARM_RUNTIME_PROFILE_LABEL] === profile.claimedProfile)
				{
					return _Activation(current, candidate, profile);
				}
				if (current.metadata?.uid !== candidate.podUid || current.metadata.resourceVersion !== candidate.resourceVersion || current.metadata.labels?.[__WARM_RUNTIME_PROFILE_LABEL] !== profile.genericProfile)
				{
					throw new Error("warm runtime Pod changed before profile activation");
				}
				const patched = await options.coreApi.patchNamespacedPod({ namespace: profile.namespace, name: candidate.podName, body: _ProfilePatch(candidate, profile) }, _RequestOptions(options));
				return _Activation(patched, candidate, profile);
			});
		},
		async proveReadiness(candidate, activation, profile): Promise<WarmRuntimeReadinessEvidence>
		{
			return await ___DoWithTrace("agent_controller.warm_runtime.prove_readiness", { namespace: profile.namespace, podUid: candidate.podUid, profile: activation.profile }, async function _Probe(): Promise<WarmRuntimeReadinessEvidence>
			{
				const url = new URL(`http://${candidate.podIp}:${profile.bindingPort}/internal/warm-runtime/readiness`);
				const response = await fetchRequest(url, { headers: { "x-opencrane-pod-uid": candidate.podUid, "x-opencrane-runtime-profile": activation.profile }, signal: AbortSignal.any([options.shutdownSignal, AbortSignal.timeout(options.requestTimeoutMilliseconds)]) });
				if (response.status !== 204)
				{
					throw new Error("warm runtime readiness probe did not cross the selected network profile");
				}
				return { ...activation, observedAt: new Date().toISOString() };
			});
		},
		async deletePod(identity, pool): Promise<void>
		{
			await ___DoWithTrace("agent_controller.warm_runtime.delete", { namespace: identity.namespace, podUid: identity.podUid }, async function _Delete(): Promise<void>
			{
				await _AssertDeletable(identity, pool, options);
				await options.coreApi.deleteNamespacedPod({ namespace: identity.namespace, name: identity.podName, body: { preconditions: { uid: identity.podUid }, gracePeriodSeconds: 0, propagationPolicy: "Background" } }, _RequestOptions(options));
			});
		},
	};
}
