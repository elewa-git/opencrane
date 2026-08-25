import type { ConfigurationOptions, V1Job, V1Pod, V1PodList } from "@kubernetes/client-node";

/** The Kubernetes calls the durable authoring validation handler may make. */
export interface SkillWorkloadControllerKubernetesStore
{
	/** Create a suspended Job, or adopt one that matches the immutable expected manifest. */
	__EnsureSuspendedJob(expected: V1Job): Promise<V1Job>;
	/** Unsuspend one bound Job with a compare-and-swap. */
	__EnsureSkillJobReleased(expected: V1Job, workloadUid: string, releaseExpiresAt: string): Promise<V1Job>;
	/** Return the Job's single worker Pod, or null while Kubernetes has not created it. */
	__FindFirstSkillWorkloadPod(expectedJob: V1Job, workloadUid: string, serviceAccountName: string): Promise<V1Pod | null>;
}

/** The Kubernetes Batch API methods used by the durable authoring validation handler. */
export interface SkillWorkloadControllerBatchApi
{
	/** Create one deterministic suspended Job. */
	createNamespacedJob(request: { readonly namespace: string; readonly body: V1Job }, options?: ConfigurationOptions): Promise<V1Job>;
	/** Read a Job for exact adoption and release checks. */
	readNamespacedJob(request: { readonly namespace: string; readonly name: string }, options?: ConfigurationOptions): Promise<V1Job>;
	/** Send the JSON patch that checks identity before it releases a Job. */
	patchNamespacedJob(request: { readonly namespace: string; readonly name: string; readonly body: readonly { readonly op: "test" | "replace"; readonly path: "/metadata/uid" | "/metadata/resourceVersion" | "/spec/activeDeadlineSeconds" | "/spec/suspend"; readonly value: string | number | boolean }[] }, options?: ConfigurationOptions): Promise<V1Job>;
}

/** The Kubernetes Core API method used to locate one authoring worker Pod. */
export interface SkillWorkloadControllerCoreApi
{
	/** List Pods through the exact Job UID and immutable workload label selector. */
	listNamespacedPod(request: { readonly namespace: string; readonly labelSelector: string }, options?: ConfigurationOptions): Promise<V1PodList>;
}

/** Dependencies of the Kubernetes adapter that serves the durable authoring validation handler. */
export interface SkillWorkloadControllerKubernetesStoreOptions
{
	/** Batch client with permissions limited to authoring Jobs. */
	readonly batchApi: SkillWorkloadControllerBatchApi;
	/** Core client limited to listing Pods in the authoring namespace. */
	readonly coreApi: SkillWorkloadControllerCoreApi;
	/** Hard timeout for every Kubernetes request. */
	readonly requestTimeoutMilliseconds: number;
	/** Shutdown signal passed to every Kubernetes request. */
	readonly shutdownSignal: AbortSignal;
}
