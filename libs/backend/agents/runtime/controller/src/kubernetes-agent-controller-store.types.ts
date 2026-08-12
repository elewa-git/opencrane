import type { ConfigurationOptions, V1Job, V1PodList, V1Secret } from "@kubernetes/client-node";

/** One RFC 6902 operation used to release an exact suspended Job. */
export interface AgentControllerJobPatchOperation
{
	/** Either a `test` that must hold for the patch to apply, or one of the two `replace` operations that do the release. */
	readonly op: "test" | "replace";
	/** The field this operation reads or writes: the UID, the resource version, the deadline, or the suspend flag. */
	readonly path: "/metadata/uid" | "/metadata/resourceVersion" | "/spec/activeDeadlineSeconds" | "/spec/suspend";
	/** The value a `test` expects, or the value a `replace` writes. */
	readonly value: string | number | boolean;
}

/** Narrow request that makes JSON Patch semantics explicit at the Kubernetes adapter boundary. */
export interface AgentControllerJobPatchRequest
{
	/** Namespace containing the exact assigned Job. */
	readonly namespace: string;
	/** Deterministic assigned Job name. */
	readonly name: string;
	/** The operations, in order: every `test` must come before the `replace` operations, or the patch could apply to a Job that had already changed. */
	readonly body: readonly AgentControllerJobPatchOperation[];
}

/**
 * The only three Batch API calls the controller makes on runtime Jobs.
 *
 * Its own small interface for two reasons: the deployed Role grants exactly these verbs and no
 * delete, and tests can supply fakes without the generated client.
 */
export interface AgentControllerBatchApi
{
	/** Create one suspended namespaced Job. */
	createNamespacedJob(request: { readonly namespace: string; readonly body: V1Job }, options?: ConfigurationOptions): Promise<V1Job>;
	/** Read one deterministic Job after an AlreadyExists response. */
	readNamespacedJob(request: { readonly namespace: string; readonly name: string }, options?: ConfigurationOptions): Promise<V1Job>;
	/** Apply one conditional JSON Patch to the exact assigned Job. */
	patchNamespacedJob(request: AgentControllerJobPatchRequest, options?: ConfigurationOptions): Promise<V1Job>;
}

/**
 * The only two Core API calls the controller makes: list its Pods, and create the attempt-key
 * Secret. Notably there is no Secret read and no delete of anything.
 */
export interface AgentControllerCoreApi
{
	/** List Pods matching the label selector built from the attempt name and the Job UID, from {@link _AgentRuntimePodSelector}. */
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
	/** Aborts every Kubernetes request when the process shuts down. */
	readonly shutdownSignal: AbortSignal;
}
