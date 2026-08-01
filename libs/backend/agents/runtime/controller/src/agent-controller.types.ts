import type { ConfigurationOptions, V1Job, V1Pod, V1PodList, V1Secret } from "@kubernetes/client-node";
import type { Logger } from "@opencrane/observability";
import type { AgentControllerRunAttemptAssignmentCommand, AgentControllerRunAttemptAssignmentResult, AgentControllerRunAttemptClaim, AgentControllerRunWorkloadRegistrationCommand, AgentControllerRunWorkloadRegistrationResult, AgentControllerRunWorkloadReleaseClaim } from "@opencrane/contracts";
import type { AgentRuntimeJobProfile } from "@opencrane/backend/agents/runtime/k8s-launcher";

/** One deployment-owned runtime profile and the sole namespace where it may create workloads. */
export interface AgentControllerRuntimeProfile extends AgentRuntimeJobProfile
{
	/** Dedicated namespace containing only Jobs and Pods of this identity profile. */
	readonly namespace: string;
}

/** Immutable runtime profiles keyed by the authority-owned profile name. */
export type AgentControllerRuntimeProfiles = Readonly<Record<string, AgentControllerRuntimeProfile>>;

/** OpenCrane authority operations available to the outbound-only controller. */
export interface AgentControllerAuthority
{
	/** Claim one durable run-attempt request, or return null when no work is ready. */
	__Claim(signal: AbortSignal): Promise<AgentControllerRunAttemptClaim | null>;
	/** Atomically persist the exact suspended Job UID for the claimed attempt. */
	__CommitAssignment(eventId: string, command: AgentControllerRunAttemptAssignmentCommand, signal: AbortSignal): Promise<AgentControllerRunAttemptAssignmentResult>;
	/** Claim one assigned workload that is ready for release, or return null when none is ready. */
	__ClaimWorkloadRelease(signal: AbortSignal): Promise<AgentControllerRunWorkloadReleaseClaim | null>;
	/** Atomically register the first exact Pod created by the assigned Job. */
	__RegisterFirstPod(eventId: string, command: AgentControllerRunWorkloadRegistrationCommand, signal: AbortSignal): Promise<AgentControllerRunWorkloadRegistrationResult>;
	/** Delete one bounded batch of successful, retention-expired run outbox records. */
	__PrunePublishedOutbox?(signal: AbortSignal): Promise<number>;
}

/** Kubernetes operations available to the assignment and release reconciliations. */
export interface AgentControllerKubernetesStore
{
	/** Create or exact-adopt the suspended attempt Job without changing it. */
	__EnsureSuspendedJob(expected: V1Job): Promise<V1Job>;
	/**
	 * Create the immutable, Job-owned attempt-scoped key Secret, or accept an existing one.
	 *
	 * Create-only: the store has no `get`/`list` on Secrets. An AlreadyExists response is treated as
	 * the idempotent replay of this exact attempt's prior creation, never re-read.
	 */
	__EnsureAttemptKeySecret(expected: V1Secret): Promise<void>;
	/** Exact-adopt or conditionally release the assigned Job within its absolute authority lifetime. */
	__EnsureRuntimeJobReleased(expected: V1Job, workloadUid: string, assignmentExpiresAt: string, releaseLeaseExpiresAt: string): Promise<V1Job>;
	/** Return the unique exact first Pod, or null while Kubernetes has not created one. */
	__FindFirstRuntimePod(expectedJob: V1Job, workloadUid: string, serviceAccountName: string): Promise<V1Pod | null>;
}

/** Dependencies and fixed policy for the controller reconciliation loop. */
export interface AgentControllerOptions
{
	/** Authenticated OpenCrane desired-state and assignment authority. */
	readonly authority: AgentControllerAuthority;
	/** Least-privilege Kubernetes projection and release adapter. */
	readonly kubernetes: AgentControllerKubernetesStore;
	/** Profiles selected by the claimed workload-profile name. */
	readonly profiles: AgentControllerRuntimeProfiles;
	/** Delay after an empty poll or a handled reconciliation failure. */
	readonly pollIntervalMilliseconds: number;
	/** Delay between durable outbox-retention maintenance attempts. */
	readonly outboxPruneIntervalMilliseconds?: number;
	/** Process-wide structured logger. */
	readonly log: Logger;
}

/** Result of one desired-state poll. */
export type AgentControllerReconcileResult =
	| { readonly outcome: "idle" }
	| { readonly outcome: "assigned" | "idempotent"; readonly eventId: string; readonly runId: string; readonly attempt: number; readonly workloadUid: string };

/** Result of one workload-release poll. */
export type AgentControllerRuntimeReleaseReconcileResult =
	| { readonly outcome: "idle" }
	| { readonly outcome: "pending-pod"; readonly eventId: string; readonly runId: string; readonly attempt: number; readonly workloadUid: string }
	| { readonly outcome: "registered" | "idempotent"; readonly eventId: string; readonly runId: string; readonly attempt: number; readonly workloadUid: string; readonly podUid: string };

/** Fetch-compatible function injected into the HTTP adapter. */
export type AgentControllerFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** Rotating projected-token reader injected into the HTTP adapter. */
export type AgentControllerTokenReader = () => Promise<string>;

/** Configuration for the projected-token-authenticated OpenCrane adapter. */
export interface AgentControllerHttpAuthorityOptions
{
	/** Internal OpenCrane base URL with no path, query, or credentials. */
	readonly openCraneInternalUrl: string;
	/** Absolute path of the rotating projected controller token. */
	readonly tokenPath: string;
	/** Hard timeout for one HTTP exchange. */
	readonly requestTimeoutMilliseconds: number;
	/** Optional fetch seam used by focused tests. */
	readonly fetch?: AgentControllerFetch;
	/** Optional rotating-token seam used by focused tests. */
	readonly readToken?: AgentControllerTokenReader;
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

/** One RFC 6902 operation used to release an exact suspended Job. */
interface AgentControllerJobPatchOperation
{
	/** Conditional test or one of the two bounded release replacements. */
	readonly op: "test" | "replace";
	/** Exact immutable, deadline, or suspend field addressed by the operation. */
	readonly path: "/metadata/uid" | "/metadata/resourceVersion" | "/spec/activeDeadlineSeconds" | "/spec/suspend";
	/** Expected field value or bounded release replacement. */
	readonly value: string | number | boolean;
}

/** Narrow request that makes JSON Patch semantics explicit at the Kubernetes adapter boundary. */
interface AgentControllerJobPatchRequest
{
	/** Namespace containing the exact assigned Job. */
	readonly namespace: string;
	/** Deterministic assigned Job name. */
	readonly name: string;
	/** Conditional patch operations in required compare-and-swap order. */
	readonly body: readonly AgentControllerJobPatchOperation[];
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
