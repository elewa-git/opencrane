import type { ConfigurationOptions, V1Job } from "@kubernetes/client-node";

import type { AgentControllerMcpbValidationAssignmentCommand, AgentControllerMcpbValidationClaim } from "@opencrane/contracts";
import type { McpbValidatorJobProfile } from "@opencrane/backend/server/gateways/mcp/validator-k8s-launcher";
import type { Logger } from "@opencrane/backend/observability";

/**
 * Calls the internal server API to claim validation work and save its Kubernetes Job UID.
 *
 * The loop must claim work before it creates a Job, so a missing or rejected claim never becomes a
 * Kubernetes workload.
 */
export interface McpbValidationControllerAuthority
{
	/** Claims one pending validation workload, or returns null when nothing is ready. */
	__Claim(signal: AbortSignal): Promise<AgentControllerMcpbValidationClaim | null>;
	/** Records the Job UID under the claim that produced it. */
	__CommitAssignment(workloadId: string, command: AgentControllerMcpbValidationAssignmentCommand, signal: AbortSignal): Promise<"assigned" | "idempotent" | "conflict">;
}

/** Creates or adopts one suspended MCP bundle validator Job. */
export interface McpbValidationControllerKubernetesStore
{
	/** Creates the expected Job, or returns the same Job when an earlier controller attempt already created it. */
	__EnsureSuspendedJob(expected: V1Job): Promise<V1Job>;
}

/** Minimal Kubernetes API used by the MCP bundle controller. */
export interface McpbValidationControllerBatchApi
{
	/** Creates a namespaced suspended Job. */
	createNamespacedJob(request: { readonly namespace: string; readonly body: V1Job }, options?: ConfigurationOptions): Promise<V1Job>;
	/** Reads a Job after a create conflict so the controller can verify it before adopting it. */
	readNamespacedJob(request: { readonly namespace: string; readonly name: string }, options?: ConfigurationOptions): Promise<V1Job>;
}

/** Dependencies for the Kubernetes adapter. */
export interface McpbValidationControllerKubernetesStoreOptions
{
	/** Kubernetes Batch client with get and create rights only in the validator namespace. */
	readonly batchApi: McpbValidationControllerBatchApi;
	/** Bounds one Kubernetes API request. */
	readonly requestTimeoutMilliseconds: number;
	/** Cancels Kubernetes calls when the controller process stops. */
	readonly shutdownSignal: AbortSignal;
}

/** Function shape injected into the HTTP adapter. */
export type McpbValidationControllerFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** Reads the rotating controller token from its mounted file. */
export type McpbValidationControllerTokenReader = () => Promise<string>;

/** Settings for the internal HTTP authority adapter. */
export interface McpbValidationControllerHttpAuthorityOptions
{
	/** OpenCrane's internal in-cluster base URL. */
	readonly openCraneInternalUrl: string;
	/** Absolute file path of the rotating controller token. */
	readonly tokenPath: string;
	/** Bounds each internal HTTP request. */
	readonly requestTimeoutMilliseconds: number;
	/** Replaces fetch in focused tests. */
	readonly fetch?: McpbValidationControllerFetch;
	/** Replaces token-file reads in focused tests. */
	readonly readToken?: McpbValidationControllerTokenReader;
}

/** Dependencies for one polling controller loop. */
export interface McpbValidationControllerOptions
{
	/** Reads and records controller work through the internal server API. */
	readonly authority: McpbValidationControllerAuthority;
	/** Creates only restricted suspended validator Jobs. */
	readonly kubernetes: McpbValidationControllerKubernetesStore;
	/** Deployment-owned validator image, namespace, identity, and resource limits. */
	readonly profile: McpbValidatorJobProfile;
	/** Wait time after an idle or failed controller pass. */
	readonly pollIntervalMilliseconds: number;
	/** Receives structured pass outcomes and failures. */
	readonly log: Logger;
}

/**
 * Describes what one MCP bundle controller pass did with its database claim.
 *
 * `Idle` means no Job was created. `Assigned` saved a new Job UID; `Idempotent` found that the same
 * Job UID was already saved. These are in-process results, not persisted workload states.
 */
export enum McpbValidationControllerReconcileOutcomes
{
	/** No saved inspection work was available during this pass. */
	Idle = "idle",
	/** The controller saved a newly created Kubernetes Job under its database claim. */
	Assigned = "assigned",
	/** The controller found the same Job assignment that a prior pass had already saved. */
	Idempotent = "idempotent",
}

/** The result of one MCP bundle validation controller pass. */
export type McpbValidationControllerReconcileResult =
	| { readonly outcome: McpbValidationControllerReconcileOutcomes.Idle }
	| { readonly outcome: McpbValidationControllerReconcileOutcomes.Assigned | McpbValidationControllerReconcileOutcomes.Idempotent; readonly workloadId: string; readonly workloadUid: string };
