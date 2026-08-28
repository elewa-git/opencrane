import type { ConfigurationOptions, V1DeleteOptions, V1Deployment, V1Pod, V1PodList, V1ReplicaSetList } from "@kubernetes/client-node";

import type { WarmRuntimePodCandidate, WarmRuntimePodIdentity, WarmRuntimePoolProfile } from "@opencrane/backend/agents/runtime/k8s-launcher";

/** Maps each server-selected AgentRun profile to one fixed Helm-owned warm pool. */
export type WarmRuntimePoolProfiles = Readonly<Record<string, WarmRuntimePoolProfile>>;

/** Records the observed profile and resource version after a conditional label activation. */
export interface WarmRuntimeProfileActivation
{
	/** Names the Pod whose label was changed. */
	readonly podUid: string;
	/** Carries the resource version returned after the conditional patch. */
	readonly resourceVersion: string;
	/** Names the fixed profile now projected on the Pod. */
	readonly profile: string;
}

/** Records a network-path probe for the exact activated Pod. */
export interface WarmRuntimeReadinessEvidence extends WarmRuntimeProfileActivation
{
	/** Records when the controller completed the network probe. */
	readonly observedAt: string;
}

/**
 * Reports what Kubernetes says about the saved claimed Pod during AgentRun recovery checks.
 *
 * `running` means the same UID still belongs to the selected pool and the workflow keeps waiting.
 * `missing` means that UID is absent or the Pod name now belongs to another UID. `terminal` means
 * that Pod reached `Succeeded` or `Failed`. Both non-running results make the workflow ask server
 * authority whether replacement is allowed; an ownership mismatch throws instead of becoming one
 * of these values.
 */
export type WarmRuntimePodObservation = "running" | "missing" | "terminal";

/** Defines Kubernetes operations available to the warm-runtime workflow handler. */
export interface WarmRuntimeKubernetesStore
{
	/** Lists valid generic candidates from one Helm-owned pool. */
	listGenericPods(profile: WarmRuntimePoolProfile): Promise<readonly WarmRuntimePodCandidate[]>;
	/** Changes only the profile label on one database-reserved Pod. */
	activateProfile(candidate: WarmRuntimePodCandidate, profile: WarmRuntimePoolProfile): Promise<WarmRuntimeProfileActivation>;
	/** Probes the exact activated Pod through the network path selected by that profile. */
	proveReadiness(candidate: WarmRuntimePodCandidate, activation: WarmRuntimeProfileActivation, profile: WarmRuntimePoolProfile): Promise<WarmRuntimeReadinessEvidence>;
	/** Observes only the saved Pod UID and rejects a Pod that no longer belongs to the selected pool. */
	observeClaimedPod(identity: WarmRuntimePodIdentity, pool: WarmRuntimePoolProfile): Promise<WarmRuntimePodObservation>;
	/** Deletes one used or stale Pod with a UID precondition and returns only after that UID is absent. */
	deletePod(identity: WarmRuntimePodIdentity, pool: WarmRuntimePoolProfile): Promise<void>;
}

/** Defines the Apps API reads needed to prove the Deployment-to-ReplicaSet owner chain. */
export interface WarmRuntimeAppsApi
{
	/** Reads the configured Helm-owned Deployment. */
	readNamespacedDeployment(request: { readonly namespace: string; readonly name: string }, options?: ConfigurationOptions): Promise<V1Deployment>;
	/** Lists ReplicaSets carrying the pool's fixed owner label. */
	listNamespacedReplicaSet(request: { readonly namespace: string; readonly labelSelector: string }, options?: ConfigurationOptions): Promise<V1ReplicaSetList>;
}

/** Defines the Pod reads and mutations granted to the controller in warm namespaces. */
export interface WarmRuntimeCoreApi
{
	/** Lists generic Pods carrying the pool and generic-profile labels. */
	listNamespacedPod(request: { readonly namespace: string; readonly labelSelector: string }, options?: ConfigurationOptions): Promise<V1PodList>;
	/** Reads one Pod before activation or deletion. */
	readNamespacedPod(request: { readonly namespace: string; readonly name: string }, options?: ConfigurationOptions): Promise<V1Pod>;
	/** Applies an RFC 6902 patch containing UID and resource-version tests. */
	patchNamespacedPod(request: { readonly namespace: string; readonly name: string; readonly body: readonly WarmRuntimePodPatchOperation[] }, options?: ConfigurationOptions): Promise<V1Pod>;
	/** Deletes one Pod using an immutable UID precondition. */
	deleteNamespacedPod(request: { readonly namespace: string; readonly name: string; readonly body: V1DeleteOptions }, options?: ConfigurationOptions): Promise<V1Pod>;
}

/** Describes one UID/resource-version/profile operation in the conditional Pod patch. */
export interface WarmRuntimePodPatchOperation
{
	/** Tests an observed value or replaces the profile label. */
	readonly op: "test" | "replace";
	/** Names the UID, resource version, or escaped profile-label field. */
	readonly path: "/metadata/uid" | "/metadata/resourceVersion" | "/metadata/labels/opencrane.ai~1warm-runtime-profile";
	/** Carries the required or replacement field value. */
	readonly value: string;
}

/** Supplies clients, deadlines, and the HTTP probe seam to the warm Kubernetes adapter. */
export interface WarmRuntimeKubernetesStoreOptions
{
	/** Reads Deployments and ReplicaSets without mutating them. */
	readonly appsApi: WarmRuntimeAppsApi;
	/** Reads, conditionally patches, and UID-deletes warm Pods. */
	readonly coreApi: WarmRuntimeCoreApi;
	/** Limits each Kubernetes call and readiness probe. */
	readonly requestTimeoutMilliseconds: number;
	/** Stops every in-flight operation when the controller drains. */
	readonly shutdownSignal: AbortSignal;
	/** Replaces fetch in deterministic readiness tests. */
	readonly fetch?: typeof fetch;
}
