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
