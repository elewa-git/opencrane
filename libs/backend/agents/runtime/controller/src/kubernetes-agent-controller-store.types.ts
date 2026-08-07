import type { ConfigurationOptions, V1Job, V1PodList, V1Secret } from "@kubernetes/client-node";

/** One RFC 6902 operation used to release an exact suspended Job. */
export interface AgentControllerJobPatchOperation
{
	/** Conditional test or one of the two bounded release replacements. */
	readonly op: "test" | "replace";
	/** Exact immutable, deadline, or suspend field addressed by the operation. */
	readonly path: "/metadata/uid" | "/metadata/resourceVersion" | "/spec/activeDeadlineSeconds" | "/spec/suspend";
	/** Expected field value or bounded release replacement. */
	readonly value: string | number | boolean;
}

/** Narrow request that makes JSON Patch semantics explicit at the Kubernetes adapter boundary. */
export interface AgentControllerJobPatchRequest
{
	/** Namespace containing the exact assigned Job. */
	readonly namespace: string;
	/** Deterministic assigned Job name. */
	readonly name: string;
	/** Conditional patch operations in required compare-and-swap order. */
	readonly body: readonly AgentControllerJobPatchOperation[];
}

/** Narrow Batch API surface used for exact Job creation, reads, and release. */
export interface AgentControllerBatchApi
{
	/** Create one suspended namespaced Job. */
	createNamespacedJob(request: { readonly namespace: string; readonly body: V1Job }, options?: ConfigurationOptions): Promise<V1Job>;
	/** Read one deterministic Job after an AlreadyExists response. */
	readNamespacedJob(request: { readonly namespace: string; readonly name: string }, options?: ConfigurationOptions): Promise<V1Job>;
	/** Apply one conditional JSON Patch to the exact assigned Job. */
	patchNamespacedJob(request: AgentControllerJobPatchRequest, options?: ConfigurationOptions): Promise<V1Job>;
}

/** Narrow Core API surface used only for exact Pod listing and attempt-key Secret creation. */
export interface AgentControllerCoreApi
{
	/** List Pods using the exact attempt and Kubernetes Job UID selector. */
	listNamespacedPod(request: { readonly namespace: string; readonly labelSelector: string }, options?: ConfigurationOptions): Promise<V1PodList>;
	/** Create one immutable, Job-owned attempt-key Secret in the runtime namespace (create-only Role). */
	createNamespacedSecret(request: { readonly namespace: string; readonly body: V1Secret }, options?: ConfigurationOptions): Promise<V1Secret>;
}

/** Clients required by the Kubernetes adapter. */
export interface AgentControllerKubernetesStoreOptions
{
	/** Kubernetes Batch client limited by Role to Jobs. */
	readonly batchApi: AgentControllerBatchApi;
	/** Kubernetes Core client limited by Role to Pod list. */
	readonly coreApi: AgentControllerCoreApi;
	/** Hard timeout independently applied to every Kubernetes request. */
	readonly requestTimeoutMilliseconds: number;
	/** Process-lifetime cancellation propagated into every Kubernetes request. */
	readonly shutdownSignal: AbortSignal;
}
