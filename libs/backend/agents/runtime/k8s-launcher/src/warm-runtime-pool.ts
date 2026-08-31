import type { V1Pod } from "@kubernetes/client-node";

import type { WarmRuntimePodCandidate, WarmRuntimePoolProfile } from "./warm-runtime-pool.types";

/** Labels Helm and the controller share without putting run or user identity on a Pod. */
export const __WARM_RUNTIME_POOL_LABEL = "opencrane.ai/warm-runtime-pool";
/** Label whose fixed value selects the Cilium profile for a warm Pod. */
export const __WARM_RUNTIME_PROFILE_LABEL = "opencrane.ai/warm-runtime-profile";

/** Validates one deployment-owned pool profile before it reaches a workflow handler. */
export function __AssertWarmRuntimePoolProfile(profile: WarmRuntimePoolProfile): void
{
	const names = [profile.namespace, profile.deploymentName, profile.serviceAccountName, profile.genericProfile, profile.claimedProfile];
	if (!names.every(function _IsName(value): boolean { return value.length <= 63 && /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/u.test(value); }))
	{
		throw new Error("warm runtime profile requires Kubernetes DNS labels");
	}
	if (profile.genericProfile === profile.claimedProfile || !/^.+@sha256:[a-f0-9]{64}$/u.test(profile.image))
	{
		throw new Error("warm runtime profile requires different generic and claimed profiles and an immutable image");
	}
	if (!Number.isSafeInteger(profile.bindingPort) || profile.bindingPort < 1024 || profile.bindingPort > 65535 || !Number.isSafeInteger(profile.genericIdleSeconds) || profile.genericIdleSeconds < 60 || profile.genericIdleSeconds > 86400)
	{
		throw new Error("warm runtime profile requires a binding port and a 1-minute to 1-day generic lifetime");
	}
	if (!profile.resources.requests?.cpu || !profile.resources.requests.memory || !profile.resources.limits?.cpu || !profile.resources.limits.memory || !/^[1-9][0-9]*(Ki|Mi|Gi)$/u.test(profile.scratchSize))
	{
		throw new Error("warm runtime profile requires CPU, memory, and bounded scratch settings");
	}
}

/** Returns the selector that lists only generic Pods from one Helm-owned warm pool. */
export function __WarmRuntimeGenericPodSelector(profile: WarmRuntimePoolProfile): string
{
	return `${__WARM_RUNTIME_POOL_LABEL}=${profile.deploymentName},${__WARM_RUNTIME_PROFILE_LABEL}=${profile.genericProfile}`;
}

/**
 * Checks a generic Pod before a workflow may ask the database to reserve it.
 *
 * The check binds the Pod to the configured Deployment, fixed ServiceAccount, generic profile, and
 * running identity. The database still decides whether this candidate wins a reservation race.
 */
export function __WarmRuntimePodCandidate(pod: V1Pod, profile: WarmRuntimePoolProfile, deploymentUid: string, replicaSetUids: ReadonlySet<string>): WarmRuntimePodCandidate
{
	const owner = pod.metadata?.ownerReferences?.find(function _ControllerOwner(reference) { return reference.controller === true; });
	const podName = pod.metadata?.name;
	const podUid = pod.metadata?.uid;
	const resourceVersion = pod.metadata?.resourceVersion;
	const podIp = pod.status?.podIP;
	if (!podName || !podUid || !resourceVersion || !podIp || !deploymentUid || pod.metadata?.namespace !== profile.namespace || pod.spec?.serviceAccountName !== profile.serviceAccountName || pod.status?.phase !== "Running" || pod.metadata.labels?.[__WARM_RUNTIME_POOL_LABEL] !== profile.deploymentName || pod.metadata.labels?.[__WARM_RUNTIME_PROFILE_LABEL] !== profile.genericProfile || owner?.apiVersion !== "apps/v1" || owner.kind !== "ReplicaSet" || !owner.uid || !replicaSetUids.has(owner.uid))
	{
		throw new Error("warm runtime candidate does not match its Helm-owned generic pool");
	}
	return { podName, podUid, resourceVersion, deploymentUid, podIp };
}
