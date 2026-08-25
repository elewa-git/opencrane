import type { ConfigurationOptions, V1Job, V1Pod, V1PodList } from "@kubernetes/client-node";

import type { AgentControllerSkillWorkloadAssignmentCommand, AgentControllerSkillWorkloadClaim, AgentControllerSkillWorkloadPodRegistrationCommand, AgentControllerSkillWorkloadReleaseClaim, AgentControllerSkillWorkloadReleaseCommand } from "@opencrane/contracts";
import type { SkillWorkloadJobProfile } from "@opencrane/backend/agents/skills/k8s-launcher";
import type { Logger } from "@opencrane/backend/observability";

/** What one reconciliation pass did. The poll loop uses this to decide whether to sleep. */
export enum SkillWorkloadControllerReconcileOutcomes
{
	/** No eligible durable work is currently available. */
	Idle = "idle",
	/** A new suspended Job assignment was committed. */
	Assigned = "assigned",
	/** The assignment or Pod registration already existed and matched, so nothing changed. */
	Idempotent = "idempotent",
	/** The Job is released but Kubernetes has not exposed its first Pod yet. */
	PendingPod = "pending-pod",
	/** The first worker Pod was recorded in the database. */
	Registered = "registered",
}

/** One deployment profile per workload class. */
export type SkillWorkloadControllerProfiles = Readonly<Record<AgentControllerSkillWorkloadClaim["kind"], SkillWorkloadJobProfile>>;

/** The OpenCrane server calls the skill controller may make. The controller only calls out; nothing calls into it. */
export interface SkillWorkloadControllerAuthority
{
	/** Claim one database-fenced pending workload, or return null when no work is ready. */
	__Claim(signal: AbortSignal): Promise<AgentControllerSkillWorkloadClaim | null>;
	/** Record the Kubernetes Job UID against the same claim the controller was given. */
	__CommitAssignment(workloadId: string, command: AgentControllerSkillWorkloadAssignmentCommand, signal: AbortSignal): Promise<"assigned" | "idempotent" | "conflict">;
	/** Claim one Job that still needs unsuspending, or one whose first Pod is not recorded yet. */
	__ClaimRelease(signal: AbortSignal): Promise<AgentControllerSkillWorkloadReleaseClaim | null>;
	/** Record that Kubernetes unsuspended the Job. */
	__CommitRelease(workloadId: string, command: AgentControllerSkillWorkloadReleaseCommand, signal: AbortSignal): Promise<"released" | "idempotent" | "conflict">;
	/** Record the first Pod this Job owns. The worker's bootstrap reference does not work until this is recorded. */
	__RegisterFirstPod(workloadId: string, command: AgentControllerSkillWorkloadPodRegistrationCommand, signal: AbortSignal): Promise<"registered" | "idempotent" | "conflict">;
}

/** The Kubernetes calls the skill controller is allowed to make. */
export interface SkillWorkloadControllerKubernetesStore
{
	/** Create the suspended Job, or adopt one that already exists and matches the expected manifest exactly. */
	__EnsureSuspendedJob(expected: V1Job): Promise<V1Job>;
	/** Unsuspend the assigned Job with a compare-and-swap, or return it unchanged when it is already unsuspended. */
	__EnsureSkillJobReleased(expected: V1Job, workloadUid: string, releaseExpiresAt: string): Promise<V1Job>;
	/** Return the Job's single worker Pod, or null while Kubernetes has not created it yet. */
	__FindFirstSkillWorkloadPod(expectedJob: V1Job, workloadUid: string, serviceAccountName: string): Promise<V1Pod | null>;
}

/** The small part of the Kubernetes Batch API this controller uses: create, read, and unsuspend skill Jobs. */
export interface SkillWorkloadControllerBatchApi
{
	/** Create one deterministic suspended Job. */
	createNamespacedJob(request: { readonly namespace: string; readonly body: V1Job }, options?: ConfigurationOptions): Promise<V1Job>;
	/** Read the Job, so it can be compared against the expected manifest and then unsuspended. */
	readNamespacedJob(request: { readonly namespace: string; readonly name: string }, options?: ConfigurationOptions): Promise<V1Job>;
	/** Send the one JSON-Patch that unsuspends the Job, guarded by its UID and resourceVersion. */
	patchNamespacedJob(request: { readonly namespace: string; readonly name: string; readonly body: readonly { readonly op: "test" | "replace"; readonly path: "/metadata/uid" | "/metadata/resourceVersion" | "/spec/activeDeadlineSeconds" | "/spec/suspend"; readonly value: string | number | boolean }[] }, options?: ConfigurationOptions): Promise<V1Job>;
}

/** The one Kubernetes Core API call this controller uses: list the Pods belonging to a skill Job. */
export interface SkillWorkloadControllerCoreApi
{
	/** List Pods through the exact Job UID and skill-workload label selector. */
	listNamespacedPod(request: { readonly namespace: string; readonly labelSelector: string }, options?: ConfigurationOptions): Promise<V1PodList>;
}

/** Dependencies of the Kubernetes adapter dedicated to the governed-skill controller. */
export interface SkillWorkloadControllerKubernetesStoreOptions
{
	/** Batch client whose permissions come from the two skill-namespace Roles. */
	readonly batchApi: SkillWorkloadControllerBatchApi;
	/** Core client constrained to Pod list in those namespaces. */
	readonly coreApi: SkillWorkloadControllerCoreApi;
	/** Hard timeout propagated to every Kubernetes request. */
	readonly requestTimeoutMilliseconds: number;
	/** Shutdown signal passed to every Kubernetes request, so requests abort when the process stops. */
	readonly shutdownSignal: AbortSignal;
}

/** Fetch-compatible function injected into the internal HTTP authority adapter. */
export type SkillWorkloadControllerFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** Reads the current controller token, which Kubernetes rotates on disk. */
export type SkillWorkloadControllerTokenReader = () => Promise<string>;

/** Settings for the adapter that calls the OpenCrane server using the controller's projected token. */
export interface SkillWorkloadControllerHttpAuthorityOptions
{
	/** Internal OpenCrane base URL with no path, query, or credentials. */
	readonly openCraneInternalUrl: string;
	/** Absolute path of the rotating projected controller token. */
	readonly tokenPath: string;
	/** Hard timeout for one HTTP exchange. */
	readonly requestTimeoutMilliseconds: number;
	/** Optional process signal that cancels in-flight internal API calls during controller shutdown. */
	readonly shutdownSignal?: AbortSignal;
	/** Optional replacement for `fetch`, used by tests. */
	readonly fetch?: SkillWorkloadControllerFetch;
	/** Optional replacement for the token reader, used by tests. */
	readonly readToken?: SkillWorkloadControllerTokenReader;
}

/** Everything one reconciliation pass needs: the server, Kubernetes, the profiles, the poll interval, and the logger. */
export interface SkillWorkloadControllerOptions
{
	/** The OpenCrane server: it hands out claims and records assignments. */
	readonly authority: SkillWorkloadControllerAuthority;
	/** Talks to Kubernetes with only the permissions this controller needs. */
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
	| { readonly outcome: SkillWorkloadControllerReconcileOutcomes.Idle }
	| { readonly outcome: SkillWorkloadControllerReconcileOutcomes.Assigned | SkillWorkloadControllerReconcileOutcomes.Idempotent; readonly workloadId: string; readonly workloadUid: string };

/** Result of one governed-skill release and first-Pod registration reconciliation. */
export type SkillWorkloadControllerReleaseReconcileResult =
	| { readonly outcome: SkillWorkloadControllerReconcileOutcomes.Idle }
	| { readonly outcome: SkillWorkloadControllerReconcileOutcomes.PendingPod; readonly workloadId: string; readonly workloadUid: string }
	| { readonly outcome: SkillWorkloadControllerReconcileOutcomes.Registered | SkillWorkloadControllerReconcileOutcomes.Idempotent; readonly workloadId: string; readonly workloadUid: string; readonly podUid: string };
