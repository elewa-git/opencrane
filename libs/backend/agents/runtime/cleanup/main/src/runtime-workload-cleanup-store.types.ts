import type { ConfigurationOptions, V1Job } from "@kubernetes/client-node";

/** Exact durable coordinates required to identify one runtime workload projection. */
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
	/** Assigned Kubernetes UID, or null when adopting a still-suspended in-flight orphan. */
	readonly workloadUid: string | null;
	/** Whether the projection has a durable assignment or is an unassigned in-flight orphan. */
	readonly mode: "assigned" | "unassigned_orphan";
}

/** Physical evidence returned after exact read and conditional deletion. */
export type KubernetesRuntimeWorkloadCleanupResult =
	| { readonly status: "absent" }
	| { readonly status: "deletion_requested"; readonly workloadUid: string };

/** Kubernetes cleanup adapter compatible with the execution/runs physical-store port. */
export interface KubernetesRuntimeWorkloadCleanupStore
{
	/** Observe absence or UID-conditionally delete one exact runtime workload projection. */
	deleteExactProjection(workload: KubernetesRuntimeWorkloadCleanupProjection): Promise<KubernetesRuntimeWorkloadCleanupResult>;
}

/** Narrow Kubernetes Batch API surface required for runtime Job cleanup. */
export interface KubernetesRuntimeWorkloadCleanupBatchApi
{
	/** Read one deterministic namespaced Job before any deletion is attempted. */
	readNamespacedJob(request: { readonly namespace: string; readonly name: string }, options?: ConfigurationOptions): Promise<V1Job>;
	/** Delete one namespaced Job only while its immutable UID still matches. */
	deleteNamespacedJob(request: { readonly namespace: string; readonly name: string; readonly body: { readonly preconditions: { readonly uid: string } } }, options?: ConfigurationOptions): Promise<unknown>;
}

/** Process-owned bounds supplied to the Kubernetes cleanup adapter. */
export interface KubernetesRuntimeWorkloadCleanupStoreOptions
{
	/** Kubernetes Batch client limited by Role to runtime Jobs. */
	readonly batchApi: KubernetesRuntimeWorkloadCleanupBatchApi;
	/** Hard deadline independently applied to each Kubernetes read and delete request. */
	readonly requestTimeoutMilliseconds: number;
	/** Process-lifetime cancellation propagated into every Kubernetes request. */
	readonly shutdownSignal: AbortSignal;
}
