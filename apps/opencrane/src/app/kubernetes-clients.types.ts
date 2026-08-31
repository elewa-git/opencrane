import type * as k8s from "@kubernetes/client-node";

/** Kubernetes clients held by the OpenCrane server process. */
export interface OpenCraneKubernetesClients
{
	/** Authentication client used for workload TokenReview. */
	readonly authApi: k8s.AuthenticationV1Api;
	/** Core client used by public API capabilities. */
	readonly coreApi: k8s.CoreV1Api;
	/** Custom-resource client used by public API capabilities. */
	readonly customApi: k8s.CustomObjectsApi;
}
