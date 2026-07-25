import type { RunInputSnapshot } from "@opencrane/contracts";
import type { JsonValue } from "@opencrane/util";

/** Finite resource allocation carved from one parent's remaining immutable run policy. */
export interface GovernedChildRunBudget
{
	/** Maximum model turns the child may consume. */
	readonly maxModelTurns: number;
	/** Maximum provider tokens the child may consume. */
	readonly maxTotalTokens: number;
	/** Maximum wall-clock duration the child may occupy. */
	readonly maxDurationMs: number;
}

/** Parent-selected immutable inputs visible to one child and no sibling. */
export interface GovernedChildRunContextSelection
{
	/** Ordered parent transcript messages copied into the child snapshot. */
	readonly messageIds: readonly string[];
	/** Parent-pinned durable fact identifiers copied into the child snapshot. */
	readonly memoryFactIds: readonly string[];
	/** Parent-pinned artifact revisions copied into the child snapshot. */
	readonly artifactRevisionIds: readonly string[];
	/** Parent-pinned skill revisions copied into the child snapshot. */
	readonly skillRevisionIds: readonly string[];
}

/** Immutable parent facts loaded by the authority boundary before it accepts one child request. */
export interface GovernedChildRunParent
{
	/** Durable identifier of the immediate spawning run. */
	readonly runId: string;
	/** Root run identifier inherited by every descendant. */
	readonly rootRunId: string;
	/** Silo containing the complete parent and child authority tree. */
	readonly siloId: string;
	/** Parent snapshot constraining every selected child input. */
	readonly snapshot: RunInputSnapshot;
	/** Number of edges between this parent and its root run. */
	readonly depth: number;
	/** Parent capacity still available after all earlier durable reservations. */
	readonly remainingBudget: GovernedChildRunBudget;
}

/** Model-proposed child request before the authority freezes derived coordinates. */
export interface GovernedChildRunSpawnRequest
{
	/** Silo requested for the child; it must exactly equal the parent silo. */
	readonly siloId: string;
	/** AgentService selected for the independently accountable child execution. */
	readonly agentServiceId: string;
	/** Effective child capability-set digest accepted by a separate verifier. */
	readonly capabilitySetDigest: string;
	/** Parent-selected immutable context visible to this one child. */
	readonly context: GovernedChildRunContextSelection;
	/** Finite budget carved from the parent. */
	readonly budget: GovernedChildRunBudget;
	/** JSON-safe task payload retained with future spawn provenance. */
	readonly task: JsonValue;
}

/** Bounded recursive-run policy applied before a child can reserve any authority. */
export interface GovernedChildRunPolicy
{
	/** Maximum parent-to-child edges allowed below the root. */
	readonly maximumDepth: number;
	/** Maximum direct child runs one parent may reserve. */
	readonly maximumChildrenPerParent: number;
}

/** Capability authority that proves a child can only narrow the parent's effective authority. */
export interface GovernedChildRunCapabilityDelegation
{
	/** Returns true only when the exact child service and digest are a verified subset of the parent. */
	allows(parentCapabilitySetDigest: string, childAgentServiceId: string, childCapabilitySetDigest: string): boolean;
}

/** Fully derived authorization supplied to the later transactional reservation and persistence boundary. */
export interface GovernedChildRunSpawnAuthorization
{
	/** Silo inherited unchanged from the parent. */
	readonly siloId: string;
	/** Root identifier inherited unchanged from the parent. */
	readonly rootRunId: string;
	/** Immediate parent identifier fixed for the child. */
	readonly parentRunId: string;
	/** Child depth fixed before a durable reservation can commit. */
	readonly depth: number;
	/** Verified child capability-set digest. */
	readonly capabilitySetDigest: string;
	/** Target AgentService approved by the capability authority. */
	readonly agentServiceId: string;
	/** Context subset proven readable by the parent. */
	readonly context: GovernedChildRunContextSelection;
	/** Budget carve-out proven to fit the parent remainder. */
	readonly budget: GovernedChildRunBudget;
	/** Detached canonical task payload. */
	readonly task: JsonValue;
}

/** Stable denial reason returned before a child can reserve durable execution authority. */
export type GovernedChildRunSpawnRefusalReason = "invalid_request" | "cross_silo" | "depth_exceeded" | "fanout_exceeded" | "capability_escalation" | "context_not_parent_readable" | "budget_exceeded";

/** Result of validating one governed child-run request against its immutable parent authority. */
export type GovernedChildRunSpawnAuthorizationResult = { readonly outcome: "authorized"; readonly authorization: GovernedChildRunSpawnAuthorization } | { readonly outcome: "denied"; readonly reason: GovernedChildRunSpawnRefusalReason };
