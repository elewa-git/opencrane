import * as k8s from "@kubernetes/client-node";

import type { OpenCraneKubernetesClients } from "./kubernetes-clients.types.js";

/**
 * Create all Kubernetes clients from one resolved process identity.
 *
 * Sharing one KubeConfig ensures public routes, TokenReview, and fenced cleanup cannot silently
 * select different clusters or credentials inside the same server process.
 */
export function _CreateKubernetesClients(): OpenCraneKubernetesClients
{
	const kubeConfig = new k8s.KubeConfig();
	kubeConfig.loadFromDefault();
	return {
		authApi: kubeConfig.makeApiClient(k8s.AuthenticationV1Api),
		batchApi: kubeConfig.makeApiClient(k8s.BatchV1Api),
		coreApi: kubeConfig.makeApiClient(k8s.CoreV1Api),
		customApi: kubeConfig.makeApiClient(k8s.CustomObjectsApi),
	};
}
