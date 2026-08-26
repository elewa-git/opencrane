import type { Logger } from "@opencrane/backend/observability";
import type { McpExecutorJobProfile, McpExecutorWorkloadClaim } from "@opencrane/backend/agents/runtime/mcp-executor/k8s-launcher";
import type { GovernedJobControllerStore } from "@opencrane/backend/agents/runtime/workloads/k8s-controller";
import type { RuntimeWorkloadBinding } from "@opencrane/backend/agents/runtime/workloads/contract";

/** One server-approved MCP claim plus the immutable image imported for it. */
export interface McpExecutorControllerClaim
{
	/** Database-issued reservation for the MCP executor class. */
	readonly claim: McpExecutorWorkloadClaim;
	/** Immutable registry reference loaded from completed OCI admission. */
	readonly registryReference: string;
}

/** A release claim for an assigned MCP Job. */
export interface McpExecutorControllerReleaseClaim extends McpExecutorControllerClaim
{
	/** Immutable UID Kubernetes assigned to the suspended Job. */
	readonly workloadUid: string;
	/** Database time that identifies this release delivery. */
	readonly releaseClaimedAt: string;
	/** Delivery generation that fences this release. */
	readonly releaseDeliveryCount: number;
	/** Database time after which the Job cannot be released. */
	readonly releaseExpiresAt: string;
}

/** The server operations the MCP controller may perform. */
export interface McpExecutorControllerAuthority
{
	/** Claims one pending MCP workload, or returns null when none is ready. */
	__Claim(signal: AbortSignal): Promise<McpExecutorControllerClaim | null>;
	/** Records the suspended Job UID against the same database claim. */
	__CommitAssignment(binding: RuntimeWorkloadBinding, signal: AbortSignal): Promise<"assigned" | "idempotent" | "conflict">;
	/** Claims one assigned Job that needs release or first-Pod registration. */
	__ClaimRelease(signal: AbortSignal): Promise<McpExecutorControllerReleaseClaim | null>;
	/** Records that Kubernetes released the saved Job UID. */
	__CommitRelease(claimId: string, command: McpExecutorReleaseCommand, signal: AbortSignal): Promise<"released" | "idempotent" | "conflict">;
	/** Records the first Pod UID owned by the released Job. */
	__RegisterFirstPod(claimId: string, command: McpExecutorPodRegistrationCommand, signal: AbortSignal): Promise<"registered" | "idempotent" | "conflict">;
}

/** Fences a release write to the delivery that performed the Kubernetes update. */
export interface McpExecutorReleaseCommand
{
	/** Database time of the claimed release delivery. */
	readonly releaseClaimedAt: string;
	/** Generation of the claimed release delivery. */
	readonly releaseDeliveryCount: number;
	/** Immutable Job UID that Kubernetes released. */
	readonly workloadUid: string;
}

/** Adds the Kubernetes-issued Pod UID to a fenced release command. */
export interface McpExecutorPodRegistrationCommand extends McpExecutorReleaseCommand
{
	/** Immutable UID of the first Pod owned by the Job. */
	readonly podUid: string;
}

/** Fetch-compatible function injected into the HTTP authority for tests. */
export type McpExecutorControllerFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** Reads the projected controller token that Kubernetes may rotate. */
export type McpExecutorControllerTokenReader = () => Promise<string>;

/** Settings for the authenticated controller-to-server HTTP adapter. */
export interface McpExecutorControllerHttpAuthorityOptions
{
	/** Internal OpenCrane origin without a path, query, or credentials. */
	readonly openCraneInternalUrl: string;
	/** Absolute path of the rotating projected controller token. */
	readonly tokenPath: string;
	/** Per-request timeout in milliseconds. */
	readonly requestTimeoutMilliseconds: number;
	/** Optional fetch replacement used by tests. */
	readonly fetch?: McpExecutorControllerFetch;
	/** Optional token reader replacement used by tests. */
	readonly readToken?: McpExecutorControllerTokenReader;
}

/** Dependencies for MCP Job reconciliation. */
export interface McpExecutorControllerOptions
{
	/** Server authority that issues and fences claims. */
	readonly authority: McpExecutorControllerAuthority;
	/** Shared Kubernetes adapter that checks exact Jobs and Pods. */
	readonly kubernetes: GovernedJobControllerStore;
	/** Deployment-owned profile for every MCP executor Job in this silo. */
	readonly profile: McpExecutorJobProfile;
	/** Delay after an idle or handled-failure pass. */
	readonly pollIntervalMilliseconds: number;
	/** Process logger for outcomes and handled failures. */
	readonly log: Logger;
}

/**
 * Tells the controller loop whether an assignment or release pass made progress.
 *
 * These values are not persisted or sent over the wire. The loop waits after `Idle` and
 * `PendingPod`; the other outcomes let it immediately poll for more work.
 */
export enum McpExecutorControllerOutcomes
{
	/** Neither database authority nor Kubernetes exposed work for this pass, so the loop may wait. */
	Idle = "idle",
	/** The suspended Job UID was committed, so the release pass may now claim it. */
	Assigned = "assigned",
	/** The database already held the same transition, so no repair is required. */
	Idempotent = "idempotent",
	/** The Job is released but Kubernetes has not exposed its first Pod, so the loop waits before retrying. */
	PendingPod = "pending-pod",
	/** The first owned Pod UID was committed, so the companion may now claim its command. */
	Registered = "registered",
}

/** Result of one MCP assignment pass. */
export type McpExecutorControllerReconcileResult = { readonly outcome: McpExecutorControllerOutcomes.Idle } | { readonly outcome: McpExecutorControllerOutcomes.Assigned | McpExecutorControllerOutcomes.Idempotent; readonly claimId: string; readonly workloadUid: string };

/** Result of one MCP release and Pod-registration pass. */
export type McpExecutorControllerReleaseResult = { readonly outcome: McpExecutorControllerOutcomes.Idle } | { readonly outcome: McpExecutorControllerOutcomes.PendingPod; readonly claimId: string; readonly workloadUid: string } | { readonly outcome: McpExecutorControllerOutcomes.Registered | McpExecutorControllerOutcomes.Idempotent; readonly claimId: string; readonly workloadUid: string; readonly podUid: string };
