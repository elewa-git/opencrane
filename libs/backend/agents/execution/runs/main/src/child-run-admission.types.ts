import type { RunInputSnapshot } from "@opencrane/contracts";
import type { JsonValue } from "@opencrane/util";

/** Immutable parent facts required to admit one governed child run. */
export interface GovernedChildRunParent
{
	/** Durable identifier of the immediate spawning run. */
	readonly runId: string;
	/** Stable root identifier shared by every node in the governed tree. */
	readonly rootRunId: string;
	/** Silo that must contain both parent and child authority. */
	readonly siloId: string;
	/** Parent snapshot that bounds every child context selection. */
	readonly snapshot: RunInputSnapshot;
	/** Depth of the parent below its root, where a root has depth zero. */
	readonly depth: number;
	/** Remaining parent budget available to carve into children. */
	readonly remainingBudget: GovernedChildRunBudget;
}

/** Explicit finite budget carved out of a parent run for one child. */
export interface GovernedChildRunBudget
{
	/** Maximum model tokens available to the child. */
	readonly maxTotalTokens: number | null;
	/** Maximum cost in USD micros available to the child. */
	readonly maxCostUsdMicros: number | null;
	/** Maximum tool calls available to the child. */
	readonly maxToolInvocations: number | null;
}

/** Parent-selected snapshot coordinates visible to one child and no sibling. */
export interface GovernedChildRunContextSelection
{
	/** Ordered transcript messages copied from the parent snapshot. */
	readonly messageIds: readonly string[];
	/** Memory facts copied from the parent snapshot. */
	readonly memoryFactIds: readonly string[];
	/** Immutable artifact revisions copied from the parent snapshot. */
	readonly artifactRevisionIds: readonly string[];
	/** Immutable skill revisions copied from the parent snapshot. */
	readonly skillRevisionIds: readonly string[];
}

/** Proposed governed child run before durable admission assigns its run identifier. */
export interface GovernedChildRunSpawnRequest
{
	/** Silo in which the child would be admitted. */
	readonly siloId: string;
	/** Target AgentService selected by the parent through its granted spawn tool. */
	readonly agentServiceId: string;
	/** Capability digest selected for the child, never inferred from its target service. */
	readonly capabilitySetDigest: string;
	/** Explicit subset of the parent snapshot available to the child. */
	readonly context: GovernedChildRunContextSelection;
	/** Budget carved from the parent's remaining budget. */
	readonly budget: GovernedChildRunBudget;
	/** Canonical JSON-safe task payload retained with the spawn receipt. */
	readonly task: JsonValue;
}

/** Bounded policy evaluated before a parent is allowed to create a child. */
export interface GovernedChildRunPolicy
{
	/** Maximum number of parent-to-child edges below one root run. */
	readonly maximumDepth: number;
	/** Maximum direct children that one parent may create. */
	readonly maximumChildrenPerParent: number;
}

/** Capability delegation proof evaluated by an owning authorization authority. */
export interface GovernedChildRunCapabilityDelegation
{
	/** Returns whether the parent may delegate exactly this target service and capability set. */
	allows(parentCapabilitySetDigest: string, childAgentServiceId: string, childCapabilitySetDigest: string): boolean;
}

/** Fully-bound request that a later transactional reservation must persist without substitutions. */
export interface GovernedChildRunSpawnAuthorization
{
	/** Reviewed silo that contains the complete parent-child authority tree. */
	readonly siloId: string;
	/** Root identifier inherited unchanged from the parent. */
	readonly rootRunId: string;
	/** Immediate parent identifier fixed for the child. */
	readonly parentRunId: string;
	/** Child depth fixed before it can execute. */
	readonly depth: number;
	/** Child's explicit snapshot subset. */
	readonly context: GovernedChildRunContextSelection;
	/** Child's bounded independently-accountable budget. */
	readonly budget: GovernedChildRunBudget;
	/** Reviewed target AgentService identifier. */
	readonly agentServiceId: string;
	/** Reviewed delegated capability-set digest. */
	readonly capabilitySetDigest: string;
	/** Reviewed canonical task payload. */
	readonly task: JsonValue;
}

/** Stable reason a proposed governed child run is refused before persistence. */
export type GovernedChildRunRefusalReason = "invalid_request" | "cross_silo" | "depth_exceeded" | "fanout_exceeded" | "capability_escalation" | "context_not_parent_readable" | "budget_exceeded";

/** Result of evaluating a governed child-run request at the parent boundary. */
export type GovernedChildRunSpawnAuthorizationResult = { readonly outcome: "authorized"; readonly authorization: GovernedChildRunSpawnAuthorization } | { readonly outcome: "denied"; readonly reason: GovernedChildRunRefusalReason };
