import type * as k8s from "@kubernetes/client-node";

/** Return a fail-closed Core API port without loading kubeconfig or constructing a Kubernetes client. */
export function _CreateUnavailableDevelopmentCoreApi(): k8s.CoreV1Api
{
	return new Proxy({}, {
		get(): () => Promise<never>
		{
			return async function _UnavailableKubernetesCapability(): Promise<never>
			{
				throw new Error("Kubernetes provider credential custody is disabled in Tier 2");
			};
		},
	}) as k8s.CoreV1Api;
}
