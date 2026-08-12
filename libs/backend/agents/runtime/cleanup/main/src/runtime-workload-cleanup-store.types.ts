import type { ConfigurationOptions, V1Job } from "@kubernetes/client-node";

/**
 * The recorded fields that pin down exactly which runtime Job cleanup may delete.
 *
 * Everything here comes from OpenCrane, never from Kubernetes. The adapter compares each field
 * against the Job it read, and refuses the delete on the first mismatch, so a Job that drifted from
 * what OpenCrane recorded is left alone for a human to look at rather than removed.
 * @see {@link KubernetesRuntimeWorkloadCleanupResult}
 */
export interface KubernetesRuntimeWorkloadCleanupProjection
{
	/** Logical run identifier expected on Job and Pod-template annotations. */
	readonly runId: string;
	/** Positive attempt number used in the deterministic Job name and annotations. */
	readonly attempt: number;
	/** Silo boundary expected on Job and Pod-template annotations. */
	readonly siloId: string;
	/** Agent service identifier expected on Job and Pod-template annotations. */
	readonly agentServiceId: string;
	/** Immutable agent revision expected on Job and Pod-template annotations. */
	readonly agentRevisionId: string;
	/** Dedicated runtime namespace containing the deterministic Job. */
	readonly namespace: string;
	/** Opaque bootstrap reference expected only on the Pod template. */
	readonly bootstrapReference: string;
	/** UID recorded at assignment. Null for an orphan Job that was never assigned one, which is why an orphan must also be suspended before it may be deleted. */
	readonly workloadUid: string | null;
	/** Whether OpenCrane recorded an assignment for this Job, or it is an orphan with none. Mirrors {@link RunWorkloadCleanupModes}. */
	readonly mode: "assigned" | "unassigned_orphan";
}

/**
 * What the adapter found, and what the caller still owes as a result.
 *
 * - `absent` — no such Job. Nothing is left to delete, so the caller may record cleanup as done
 *   (an orphan gets one extra confirming pass first).
 * - `deletion_requested` — a delete was accepted for the Job with this UID. Kubernetes deletes
 *   asynchronously, so the Job may still be terminating and its Pod may still be running.
 *
 * A caller that treats `deletion_requested` as `absent` would record the run as torn down while
 * its Pod is still alive. Cleanup is only finished once a later pass sees `absent`.
 */
export type KubernetesRuntimeWorkloadCleanupResult =
	| { readonly status: "absent" }
	| { readonly status: "deletion_requested"; readonly workloadUid: string };

/**
 * The Kubernetes side of runtime cleanup, kept behind a port so the durable cleanup policy never
 * handles a Kubernetes type.
 *
 * Called by: the reconciliation in
 * `libs/backend/agents/execution/runs/main/src/runtime-workload-cleanup.ts`, which reaches it as
 * the `store` dependency of `__CreateRuntimeWorkloadCleanupUseCase`. Implemented by
 * {@link __CreateKubernetesRuntimeWorkloadCleanupStore}.
 * @see {@link RuntimeWorkloadCleanupStore}
 */
export interface KubernetesRuntimeWorkloadCleanupStore
{
	/**
	 * Read the Job named by this claim and, if it matches, ask Kubernetes to delete it.
	 * @param workload - Recorded coordinates; every one is compared against the Job that was read.
	 * @returns `absent` when there is no such Job and the caller may record cleanup as done, or
	 * `deletion_requested` with the UID that was deleted — in which case the Job may still be
	 * terminating and cleanup is not finished yet.
	 * @throws When the Job exists but differs from the claim, or when Kubernetes fails for any reason
	 * other than a 404. Both mean the caller must not record cleanup as done.
	 */
	deleteExactProjection(workload: KubernetesRuntimeWorkloadCleanupProjection): Promise<KubernetesRuntimeWorkloadCleanupResult>;
}

/**
 * The only two Batch API calls runtime Job cleanup makes.
 *
 * Declared as its own small interface for two reasons: the deployed Role grants exactly these two
 * verbs on Jobs and nothing else, and tests can supply a fake without the generated client.
 */
export interface KubernetesRuntimeWorkloadCleanupBatchApi
{
	/** Read one deterministic namespaced Job before any deletion is attempted. */
	readNamespacedJob(request: { readonly namespace: string; readonly name: string }, options?: ConfigurationOptions): Promise<V1Job>;
	/** Delete one namespaced Job only while its immutable UID still matches. */
	deleteNamespacedJob(request: { readonly namespace: string; readonly name: string; readonly body: { readonly preconditions: { readonly uid: string } } }, options?: ConfigurationOptions): Promise<unknown>;
}

/**
 * What the process hands the cleanup adapter: its client, its per-request timeout, and its
 * shutdown signal. All three are fixed for the life of the process; the adapter never changes them.
 */
export interface KubernetesRuntimeWorkloadCleanupStoreOptions
{
	/** Kubernetes Batch client limited by Role to runtime Jobs. */
	readonly batchApi: KubernetesRuntimeWorkloadCleanupBatchApi;
	/** Hard deadline independently applied to each Kubernetes read and delete request. */
	readonly requestTimeoutMilliseconds: number;
	/** Aborts every Kubernetes request when the process shuts down. */
	readonly shutdownSignal: AbortSignal;
}
