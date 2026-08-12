/** Immutable budget carved from a parent run for one governed child. */
export interface ChildRunBudget
{
	/** Maximum model tokens the child may consume. */
	readonly maxTokens: number;
	/** Maximum micro-USD the child may spend. */
	readonly maxCostUsdMicros: number;
}

/** Parent authority facts already loaded at the child-run admission fence. */
export interface ChildRunParentAuthority
{
	/** Parent logical run identifier. */
	readonly runId: string;
	/** Silo that owns the entire run tree. */
	readonly siloId: string;
	/** Root run identifier shared by every descendant. */
	readonly rootRunId: string;
	/** Parent depth below the root. */
	readonly depth: number;
	/** Subject whose authority the parent may broker to a child. */
	readonly executionSubjectId: string;
	/** Tokens still unreserved by the parent and its existing children. */
	readonly remainingTokens: number;
	/** Micro-USD still unreserved by the parent and its existing children. */
	readonly remainingCostUsdMicros: number;
	/** Number of children already admitted directly beneath this parent. */
	readonly admittedChildCount: number;
}

/** Server-owned bounds applied to every parent fork. */
export interface ChildRunAdmissionLimits
{
	/** Maximum child depth below a root run. */
	readonly maximumDepth: number;
	/** Maximum directly admitted children under one parent run. */
	readonly maximumChildrenPerParent: number;
}

/** Request to prepare one child admission from parent-owned authority facts. */
export interface PrepareChildRunAdmissionCommand
{
	/** New logical child run identifier. */
	readonly childRunId: string;
	/** Target service selected by the parent's already-authorized tool policy. */
	readonly targetAgentServiceId: string;
	/** Target immutable revision selected by the same policy. */
	readonly targetAgentRevisionId: string;
	/** Requested bounded child allocation. */
	readonly requestedBudget: ChildRunBudget;
}

/** Re-checks whether the parent is allowed to hand work to this exact service revision. */
export interface ChildRunTargetAuthorization
{
	/**
	 * Returns whether the already-authorized parent may invoke this exact child target.
	 *
	 * The persistence boundary must invoke this check again in the transaction that reserves the
	 * child budget, so a policy change cannot race the durable admission.
	 */
	authorize(parent: ChildRunParentAuthority, command: PrepareChildRunAdmissionCommand): Promise<ChildRunTargetAuthorizationResult>;
}

/** Result returned by the policy that controls parent-to-child delegation. */
export type ChildRunTargetAuthorizationResult = { readonly outcome: "authorized" } | { readonly outcome: "denied" };

/** Values taken from the parent that the persistence and snapshot code must write through unchanged. */
export interface PreparedChildRunAdmission
{
	/** Depth inherited from the parent and fixed for this exact child. */
	readonly depth: number;
	/** Child run identifier. */
	readonly runId: string;
	/** Parent run identifier; a child never starts as a root. */
	readonly parentRunId: string;
	/** Shared root run identifier for aggregate budget and audit. */
	readonly rootRunId: string;
	/** Silo inherited from the parent. */
	readonly siloId: string;
	/** Subject inherited from parent authority rather than the spawn-tool payload. */
	readonly executionSubjectId: string;
	/** Target service chosen by the parent-approved delegation policy. */
	readonly agentServiceId: string;
	/** Target revision chosen by the parent-approved delegation policy. */
	readonly agentRevisionId: string;
	/** Existing trigger representing an agent-originated managed invocation. */
	readonly trigger: "managed_invocation";
	/** Budget the persistence boundary must atomically reserve before creating this child. */
	readonly budget: ChildRunBudget;
}

/**
 * The decision about one child run, and what each refusal means for the caller.
 *
 * `prepared` carries values the persistence layer must write through exactly as given. Of the
 * refusals, `depth_exceeded`, `fanout_exceeded` and `target_not_authorized` are permanent for
 * this parent and must be reported to the agent; `budget_exceeded` can succeed later if the
 * parent's children release budget; `target_authorization_unavailable` means the policy could not
 * be consulted, so it is the only one worth retrying unchanged.
 */
export type PrepareChildRunAdmissionResult = { readonly outcome: "prepared"; readonly value: PreparedChildRunAdmission } | { readonly outcome: "denied"; readonly reason: "invalid_command" | "invalid_parent_authority" | "depth_exceeded" | "fanout_exceeded" | "budget_exceeded" | "target_not_authorized" | "target_authorization_unavailable" };
