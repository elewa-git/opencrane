/** Fully validated database-blind agent controller configuration. */
export interface AgentControllerProcessConfig
{
	/** Namespace in which the controller is RBAC-permitted to manipulate Jobs and Pods. */
	readonly runtimeNamespace: string;
	/** Exact runtime ServiceAccount the controller is allowed to assign. */
	readonly runtimeServiceAccountName: string;
	/** Immutable runtime OCI image the controller is allowed to assign. */
	readonly runtimeImage: string;
	/** Private OpenCrane authority base URL. */
	readonly openCraneInternalUrl: string;
	/** Separate projected controller token accepted by OpenCrane only. */
	readonly openCraneTokenPath: string;
	/** Kubernetes API projected token path. */
	readonly kubernetesTokenPath: string;
	/** Kubernetes API CA bundle path. */
	readonly kubernetesCaPath: string;
	/** Maximum cadence for the bounded one-Job reconciliation loop. */
	readonly pollIntervalMs: number;
	/** Pod-local HTTP port reserved for kubelet liveness and readiness probes. */
	readonly healthPort: number;
}
