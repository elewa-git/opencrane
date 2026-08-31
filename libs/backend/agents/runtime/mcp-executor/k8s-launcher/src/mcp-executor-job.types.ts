import type { V1ResourceRequirements } from "@kubernetes/client-node";

import { RuntimeWorkloadClaimClasses, type RuntimeWorkloadClaim } from "@opencrane/backend/agents/runtime/workloads/contract";

/**
 * Controls when Kubernetes pulls the uploaded server and companion images.
 *
 * Both images remain digest-pinned, so this setting changes cache use rather than image identity.
 */
export type McpExecutorImagePullPolicy = "Always" | "IfNotPresent" | "Never";

/** A shared claim narrowed to the MCP executor class before it reaches the Job builder. */
export interface McpExecutorWorkloadClaim extends RuntimeWorkloadClaim
{
	/** Fixes this claim to the MCP executor; another class cannot be projected as this Job. */
	readonly workloadClass: RuntimeWorkloadClaimClasses.McpExecutor;
}

/**
 * Saved authority and imported image used to build one MCP executor Job.
 *
 * The image is loaded by the MCP authority from a completed OCI admission record. Neither the
 * controller nor a request body may replace it. The namespace must match the deployment profile.
 */
export interface McpExecutorJobAssignment
{
	/** Database-issued reservation and controller lease. */
	readonly claim: McpExecutorWorkloadClaim;
	/** Immutable image reference produced by OCI registry import. */
	readonly registryReference: string;
	/** Dedicated namespace selected by the deployment-owned profile. */
	readonly namespace: string;
}

/**
 * Deployment settings shared by every OCI-backed MCP Job in one silo.
 *
 * The profile fixes the companion image, identity, destination, lifetime, and resource limits. The
 * uploaded server image is deliberately absent because it comes from the saved MCP authority.
 */
export interface McpExecutorJobProfile
{
	/** Digest-pinned OpenCrane companion image that speaks to the uploaded MCP server. */
	readonly companionImage: string;
	/** Pull behaviour for both immutable container images. */
	readonly imagePullPolicy: McpExecutorImagePullPolicy;
	/** Trusted namespace containing the OpenCrane server; it must differ from the Job namespace. */
	readonly serverNamespace: string;
	/** Dedicated namespace for OCI-backed MCP Jobs. */
	readonly namespace: string;
	/** Fixed zero-RBAC identity; validation requires `mcp-executor-default`. */
	readonly serviceAccountName: string;
	/** Fixed cluster-local endpoint used by the companion. */
	readonly opencraneInternalUrl: string;
	/** Lifetime of the companion's projected token in seconds. */
	readonly projectedTokenTtlSeconds: number;
	/** Size of each container's separate temporary filesystem. */
	readonly scratchSize: string;
	/** Longest the one-use Job may run before Kubernetes stops it. */
	readonly activeDeadlineSeconds: number;
	/** CPU and memory limits for the uploaded MCP server. */
	readonly serverResources: V1ResourceRequirements;
	/** CPU and memory limits for the OpenCrane companion. */
	readonly companionResources: V1ResourceRequirements;
}
