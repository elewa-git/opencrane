import type { ConfigurationOptions, V1Job, V1Pod, V1PodList } from "@kubernetes/client-node";

import type { AgentControllerSkillWorkloadAssignmentCommand, AgentControllerSkillWorkloadClaim } from "@opencrane/contracts";
import type { SkillWorkloadJobProfile } from "@opencrane/backend/agents/skills/k8s-launcher";
import type { Logger } from "@opencrane/observability";

/** Immutable profile map keyed by the one permitted governed skill workload class. */
export type SkillWorkloadControllerProfiles = Readonly<Record<AgentControllerSkillWorkloadClaim["kind"], SkillWorkloadJobProfile>>;

/** OpenCrane operations available to the outbound-only governed-skill controller. */
export interface SkillWorkloadControllerAuthority
{
	/** Claim one database-fenced pending workload, or return null when no work is ready. */
	__Claim(signal: AbortSignal): Promise<AgentControllerSkillWorkloadClaim | null>;
	/** Atomically bind the exact Kubernetes Job UID to the claimed workload generation. */
	__CommitAssignment(workloadId: string, command: AgentControllerSkillWorkloadAssignmentCommand, signal: AbortSignal): Promise<"assigned" | "idempotent" | "conflict">;
	/** Claim one durable Job release or incomplete first-Pod registration. */
	__ClaimRelease(signal: AbortSignal): Promise<SkillWorkloadControllerReleaseClaim | null>;
	/** Commit the exact successful Kubernetes unsuspend operation. */
	__CommitRelease(workloadId: string, command: SkillWorkloadControllerReleaseCommand, signal: AbortSignal): Promise<"released" | "idempotent" | "conflict">;
	/** Bind the first exact Job-owned worker Pod before bootstrap can become usable. */
	__RegisterFirstPod(workloadId: string, command: SkillWorkloadControllerPodRegistrationCommand, signal: AbortSignal): Promise<"registered" | "idempotent" | "conflict">;
}

/** Database-fenced skill Job release that contains only reconstruction coordinates. */
export interface SkillWorkloadControllerReleaseClaim
{
	/** Stable governed skill workload identifier. */
	readonly workloadId: string;
	/** ClusterTenant silo owning this Job. */
	readonly siloId: string;
	/** Fixed worker class that selects the immutable deployment profile. */
	readonly kind: AgentControllerSkillWorkloadClaim["kind"];
	/** Immutable Kubernetes Job UID expected by every release and Pod operation. */
	readonly workloadUid: string;
	/** Database-issued release-claim instant. */
	readonly releaseClaimedAt: string;
	/** Monotonic database release generation. */
	readonly releaseDeliveryCount: number;
	/** Absolute release-claim or bootstrap expiry. */
	readonly expiresAt: string;
}

/** Exact release fence sent back after the Kubernetes conditional patch succeeds. */
export interface SkillWorkloadControllerReleaseCommand
{
	/** Same database-issued release-claim instant. */
	readonly releaseClaimedAt: string;
	/** Same monotonic database release generation. */
	readonly releaseDeliveryCount: number;
	/** Immutable Job UID returned by Kubernetes. */
	readonly workloadUid: string;
}

/** Exact first-Pod evidence sent back only after Kubernetes identity checks pass. */
export interface SkillWorkloadControllerPodRegistrationCommand extends SkillWorkloadControllerReleaseCommand
{
	/** Immutable UID of the sole selected Job-owned Pod. */
	readonly podUid: string;
}

/** Kubernetes operation permitted to the skill controller reconciliation. */
export interface SkillWorkloadControllerKubernetesStore
{
	/** Create or exact-adopt one deterministic still-suspended governed skill Job. */
	__EnsureSuspendedJob(expected: V1Job): Promise<V1Job>;
	/** Exact-adopt or compare-and-swap release the assigned governed-skill Job. */
	__EnsureSkillJobReleased(expected: V1Job, workloadUid: string, releaseExpiresAt: string): Promise<V1Job>;
	/** Return the unique exact first worker Pod, or null while Kubernetes has not created it. */
	__FindFirstSkillWorkloadPod(expectedJob: V1Job, workloadUid: string, serviceAccountName: string): Promise<V1Pod | null>;
}

/** Narrow Batch API surface used only to exact-adopt and release governed skill Jobs. */
export interface SkillWorkloadControllerBatchApi
{
	/** Create one deterministic suspended Job. */
	createNamespacedJob(request: { readonly namespace: string; readonly body: V1Job }, options?: ConfigurationOptions): Promise<V1Job>;
	/** Read one deterministic Job for exact adoption and compare-and-swap release. */
	readNamespacedJob(request: { readonly namespace: string; readonly name: string }, options?: ConfigurationOptions): Promise<V1Job>;
	/** Apply the sole UID-and-resource-version-fenced governed-skill release patch. */
	patchNamespacedJob(request: { readonly namespace: string; readonly name: string; readonly body: readonly { readonly op: "test" | "replace"; readonly path: "/metadata/uid" | "/metadata/resourceVersion" | "/spec/activeDeadlineSeconds" | "/spec/suspend"; readonly value: string | number | boolean }[] }, options?: ConfigurationOptions): Promise<V1Job>;
}

/** Narrow Core API surface used only to select one exact Job-owned worker Pod. */
export interface SkillWorkloadControllerCoreApi
{
	/** List Pods through the exact Job UID and skill-workload label selector. */
	listNamespacedPod(request: { readonly namespace: string; readonly labelSelector: string }, options?: ConfigurationOptions): Promise<V1PodList>;
}

/** Dependencies of the Kubernetes adapter dedicated to the governed-skill controller. */
export interface SkillWorkloadControllerKubernetesStoreOptions
{
	/** Batch client constrained by the two skill namespace Roles. */
	readonly batchApi: SkillWorkloadControllerBatchApi;
	/** Core client constrained to Pod list in those namespaces. */
	readonly coreApi: SkillWorkloadControllerCoreApi;
	/** Hard timeout propagated to every Kubernetes request. */
	readonly requestTimeoutMilliseconds: number;
	/** Process shutdown propagated to every Kubernetes request. */
	readonly shutdownSignal: AbortSignal;
}

/** Fetch-compatible function injected into the internal HTTP authority adapter. */
export type SkillWorkloadControllerFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** Rotating projected-token reader injected into the internal HTTP authority adapter. */
export type SkillWorkloadControllerTokenReader = () => Promise<string>;

/** Configuration for the projected-token-authenticated governed skill authority adapter. */
export interface SkillWorkloadControllerHttpAuthorityOptions
{
	/** Internal OpenCrane base URL with no path, query, or credentials. */
	readonly openCraneInternalUrl: string;
	/** Absolute path of the rotating projected controller token. */
	readonly tokenPath: string;
	/** Hard timeout for one HTTP exchange. */
	readonly requestTimeoutMilliseconds: number;
	/** Optional fetch seam used by focused tests. */
	readonly fetch?: SkillWorkloadControllerFetch;
	/** Optional rotating-token seam used by focused tests. */
	readonly readToken?: SkillWorkloadControllerTokenReader;
}

/** Fixed policy and adapters for one governed skill workload reconciliation. */
export interface SkillWorkloadControllerOptions
{
	/** Authenticated desired-state and assignment authority. */
	readonly authority: SkillWorkloadControllerAuthority;
	/** Least-privilege Kubernetes creation and exact-adoption adapter. */
	readonly kubernetes: SkillWorkloadControllerKubernetesStore;
	/** Deployment-owned profiles for the only two governed workload classes. */
	readonly profiles: SkillWorkloadControllerProfiles;
	/** Delay after an idle poll or a handled reconciliation failure. */
	readonly pollIntervalMilliseconds: number;
	/** Process-wide structured logger. */
	readonly log: Logger;
}

/** Result of one controller desired-state poll. */
export type SkillWorkloadControllerReconcileResult =
	| { readonly outcome: "idle" }
	| { readonly outcome: "assigned" | "idempotent"; readonly workloadId: string; readonly workloadUid: string };

/** Result of one governed-skill release and first-Pod registration reconciliation. */
export type SkillWorkloadControllerReleaseReconcileResult =
	| { readonly outcome: "idle" }
	| { readonly outcome: "pending-pod"; readonly workloadId: string; readonly workloadUid: string }
	| { readonly outcome: "released" | "registered" | "idempotent"; readonly workloadId: string; readonly workloadUid: string; readonly podUid: string };
