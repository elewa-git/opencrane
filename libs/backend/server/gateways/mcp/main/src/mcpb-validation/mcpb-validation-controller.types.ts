import type { Router } from "express";

import type { McpbValidationWorkloadAssignment, McpbValidationWorkloadClaim } from "./mcpb-validation-repository.types";

/** Reviews the single projected-token identity that may dispatch MCP bundle validator Jobs. */
export interface McpbValidationControllerTokenReviewer
{
	/** Returns a fixed controller identity, or null when the projected token is not accepted. */
	__Review(token: string): Promise<unknown | null>;
}

/** Opens the transaction that owns MCP bundle workload claims and assignments. */
export interface McpbValidationControllerAuthority
{
	/** Claims one pending workload, or returns null when the controller has nothing to do. */
	claimNextAtomically(): Promise<McpbValidationWorkloadClaim | null>;
	/** Saves a Kubernetes Job UID under the exact controller claim that produced it. */
	commitAssignmentAtomically(workloadId: string, assignment: McpbValidationWorkloadAssignment): Promise<"assigned" | "idempotent" | "conflict">;
}

/** Minimal logger surface used by the internal controller transport. */
export interface McpbValidationControllerLogger
{
	/** Records a controller authority outage without logging bearer tokens or request bodies. */
	error(bindings: { readonly err: unknown; readonly operation: string }, message: string): void;
}

/** Dependencies for the controller-only MCP bundle validator route. */
export interface McpbValidationControllerRouterDependencies
{
	/** Verifies that the caller is the fixed agent-controller workload identity. */
	readonly tokenReviewer: McpbValidationControllerTokenReviewer;
	/** Claims validator work and records exact Job assignments. */
	readonly authority: McpbValidationControllerAuthority;
	/** Receives bounded operational errors from this transport boundary. */
	readonly logger: McpbValidationControllerLogger;
}

/** Builds the internal router that the agent controller uses for MCP bundle validator workloads. */
export type CreateMcpbValidationControllerRouter = (dependencies: McpbValidationControllerRouterDependencies) => Router;
