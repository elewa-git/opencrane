import type { AgentRunWorkflowControllerAuthority } from "@opencrane/backend/agents/execution/runs/workflows/contract";

/** Describes the reviewed controller identity returned by Kubernetes TokenReview. */
export interface AgentRunWorkflowControllerIdentity
{
	/** Carries the Kubernetes username for the projected ServiceAccount token. */
	readonly username: string;
	/** Carries the namespace Kubernetes associated with that ServiceAccount. */
	readonly namespace: string;
	/** Carries the exact ServiceAccount name Kubernetes authenticated. */
	readonly serviceAccountName: string;
	/** Carries the token audiences Kubernetes accepted for this identity. */
	readonly audiences: readonly string[];
}

/** Reviews a presented controller token before the request reaches run state. */
export interface AgentRunWorkflowControllerTokenReviewer
{
	/** Returns the reviewed Kubernetes identity, or null for a rejected token. */
	__Review(token: string): Promise<AgentRunWorkflowControllerIdentity | null>;
}

/** Records safe controller-boundary failures without serialising request bodies or credentials. */
export interface AgentRunWorkflowControllerRouterLogger
{
	/** Records an internal failure with the route operation that failed. */
	error(bindings: { readonly err: unknown; readonly operation: string }, message: string): void;
}

/** Supplies the identity, server authority, and logging boundary for AgentRun workflow tasks. */
export interface AgentRunWorkflowControllerRouterDependencies
{
	/** Reviews the dedicated controller projected token. */
	readonly tokenReviewer: AgentRunWorkflowControllerTokenReviewer;
	/** Fixes the namespace in which the controller identity must live. */
	readonly namespace: string;
	/** Owns receipt fencing, lifecycle state, key revocation, and workload bindings. */
	readonly authority: AgentRunWorkflowControllerAuthority;
	/** Records safe server-side errors without request bodies or raw keys. */
	readonly logger: AgentRunWorkflowControllerRouterLogger;
}
