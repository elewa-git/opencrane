import type { ProductAuthorizationActions, ProductAuthorizationResourceLocator } from "@opencrane/models/authorization";

import type { ProductAuthorizationActorKind } from "./authorization-authority.types";

/**
 * Describes one product resource and action covered by a runtime-effect decision.
 *
 * The runtime preparation path builds these coordinates from domain-owned resource locators. The
 * authorization authority admits each coordinate, and ToolInvocation persistence stores the full
 * ordered set so a worker cannot substitute a different resource or action before dispatch.
 * Called by: libs/backend/agents/execution/protocol/src/runtime-candidate-preparation.ts.
 * @see ToolInvocationAuthorizationEvidence
 */
export interface ToolInvocationAuthorizationCoordinate
{
	/** Trusted resource selected by its owning product domain. */
	readonly resource: ProductAuthorizationResourceLocator;
	/** Central catalogue action admitted for that resource. */
	readonly action: ProductAuthorizationActions;
}

/**
 * Carries the central decisions that admitted a runtime effect.
 *
 * This evidence binds the acting Principal, current membership revision, resource decisions, and
 * workload assignment to the invocation. The repository stores it with the invocation before the
 * provider worker can claim the effect; missing or partial stored evidence makes row mapping fail.
 * Called by: libs/backend/agents/execution/protocol/src/runtime-candidate-preparation.ts and
 * ./prisma-tool-invocation-repository.ts.
 * @see ToolInvocationIntent
 */
export interface ToolInvocationAuthorizationEvidence
{
	/** Local Principal whose current grants admitted the effect. */
	readonly principalId: string;
	/** Human or managed-service actor class used by the authority. */
	readonly actorKind: Extract<ProductAuthorizationActorKind, "user" | "agent-service">;
	/** Canonically ordered resource and action set admitted for this effect. */
	readonly coordinates: readonly ToolInvocationAuthorizationCoordinate[];
	/** Canonically ordered authority decision digests covering the coordinate set. */
	readonly decisionDigests: readonly `sha256:${string}`[];
	/** Current signed membership revision used by every decision. */
	readonly membershipRevision: number;
	/** Digest of the exact workload assignment that proposed the effect. */
	readonly assignmentDigest: `sha256:${string}`;
	/** Digest binding this evidence to the outer run, attempt, revision, and argument fields. */
	readonly evidenceDigest: `sha256:${string}`;
}

/**
 * Carries the central decision that admitted a caller-owned MCP task effect.
 *
 * A public task has no AgentRun, membership-revision fence, or workload assignment. Its evidence
 * instead binds the caller Principal and admitted tool coordinate to the task-owned invocation.
 * The MCP task repository writes this shape from the result returned by `admitPrincipal`; the
 * ToolInvocation mapper rejects partial task evidence before an executor may use the row.
 * Called by: libs/backend/server/gateways/mcp/main/src/mcp-tasks/prisma-mcp-task-repository.ts and
 * ./prisma-tool-invocation-repository.ts.
 * @see ToolInvocationAuthorizationEvidence for the AgentRun-owned evidence shape.
 */
export interface McpTaskToolInvocationAuthorizationEvidence
{
	/** Local Principal whose current grants admitted the task effect. */
	readonly principalId: string;
	/** Public tasks currently execute only for their authenticated human caller. */
	readonly actorKind: "user";
	/** Tool revision and Invoke action admitted for this task. */
	readonly coordinates: readonly ToolInvocationAuthorizationCoordinate[];
	/** Decision digest returned by the central authority for each stored coordinate. */
	readonly decisionDigests: readonly `sha256:${string}`[];
	/** Digest binding the central decision to the silo, task, tool revision, and arguments. */
	readonly evidenceDigest: `sha256:${string}`;
}
