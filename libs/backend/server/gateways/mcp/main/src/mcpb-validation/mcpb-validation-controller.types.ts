import type { Router } from "express";

import type { McpbValidationWorkloadAssignment, McpbValidationWorkloadClaim } from "./mcpb-validation-repository.types";

/**
 * Reviews the projected token used by the agent-controller route.
 *
 * The router uses the result only to allow or deny a request; it never accepts a caller-selected
 * controller identity. `null` makes the router return its fixed 401 response.
 * Called by: {@link __CreateMcpbValidationControllerRouter}.
 */
export interface McpbValidationControllerTokenReviewer
{
	/**
	 * Reviews the supplied projected token.
	 * @param token - Bearer token read from the controller request.
	 * @returns An accepted identity, or `null` when the router must deny the request.
	 */
	__Review(token: string): Promise<unknown | null>;
}

/**
 * Changes MCP bundle validation workload claims and Kubernetes Job assignments in a database transaction.
 *
 * A claim supplies the fence that must accompany its Job UID. The result prevents a stale controller
 * from treating a newer claim as assigned.
 * Called by: {@link __CreateMcpbValidationControllerRouter}.
 */
export interface McpbValidationControllerAuthority
{
	/**
	 * Claims the next available workload through the database authority.
	 * @returns The saved claim fence, or `null` when no workload is available for this controller pass.
	 */
	claimNextAtomically(): Promise<McpbValidationWorkloadClaim | null>;
	/**
	 * Records a Job UID under the claim fence returned to this controller.
	 * @param workloadId - Identifies the workload claimed by this controller.
	 * @param assignment - Carries the returned claim fence and Kubernetes Job UID.
	 * @returns `assigned` when saved, `idempotent` when the same assignment already exists, or `conflict` when the controller must not use its Job.
	 */
	commitAssignmentAtomically(workloadId: string, assignment: McpbValidationWorkloadAssignment): Promise<"assigned" | "idempotent" | "conflict">;
}

/** Lets the internal route report authority failures without owning a logging implementation. */
export interface McpbValidationControllerLogger
{
	/** Records a controller authority outage without logging bearer tokens or request bodies. */
	error(bindings: { readonly err: unknown; readonly operation: string }, message: string): void;
}

/**
 * Supplies the three boundaries that the controller route needs.
 *
 * Keeping token review, database authority, and error reporting separate stops the HTTP layer from
 * deciding which workload is valid or changing database state itself.
 * Called by: OpenCrane's internal runtime composition.
 */
export interface McpbValidationControllerRouterDependencies
{
	/** Verifies that the caller is the fixed agent-controller workload identity. */
	readonly tokenReviewer: McpbValidationControllerTokenReviewer;
	/** Claims validator work and records exact Job assignments. */
	readonly authority: McpbValidationControllerAuthority;
	/** Receives bounded operational errors from this transport boundary. */
	readonly logger: McpbValidationControllerLogger;
}

/** Names the controller-router factory used by application composition. */
export type CreateMcpbValidationControllerRouter = (dependencies: McpbValidationControllerRouterDependencies) => Router;
