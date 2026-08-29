import type { AgentControllerSkillWorkloadAssignmentCommand, AgentControllerSkillWorkloadClaim, AgentControllerSkillWorkloadPodRegistrationCommand, AgentControllerSkillWorkloadReleaseClaim, AgentControllerSkillWorkloadReleaseCommand } from "@opencrane/contracts";
import type { SkillWorkloadJobProfile } from "@opencrane/backend/agents/skills/k8s-launcher";
import type { Logger } from "@opencrane/backend/observability";
import type { GovernedJobControllerStore } from "@opencrane/backend/agents/runtime/workloads/k8s-controller";

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
	readonly kubernetes: GovernedJobControllerStore;
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
