/** Stable categories allowed in a display-safe Agent-thread delivery to its immediate parent. */
export enum AgentThreadDeliveryKinds
{
	/** Short progress update with no hidden execution detail. */
	Status = "status",
	/** Participant question backed by a recoverable elicitation. */
	Question = "question",
	/** Approval request backed by a recoverable elicitation. */
	Approval = "approval",
	/** Display-safe result summary. */
	Result = "result",
	/** Truthful failure summary that claims no result. */
	Failure = "failure",
	/** Reference to an asset that has passed its own release authority. */
	Asset = "asset",
}

/** Exact AG-UI CUSTOM event name carrying one display-safe immediate-parent delivery. */
export const AG_UI_AGENT_THREAD_PARENT_DELIVERY_EVENT = "opencrane.agent_thread_parent_delivery";

/** Exact display-safe delivery envelope retained by a parent conversation's browser projection. */
export interface AgUiAgentThreadParentDeliveryEnvelope
{
	/** Stable append identity used for idempotent adoption. */
	readonly id: string;
	/** Child conversation that authored the delivery. */
	readonly childConversationId: string;
	/** Safe category selected by the child authority. */
	readonly kind: AgentThreadDeliveryKinds;
	/** Short display label. */
	readonly label: string;
	/** Sanitized detail without provider bodies, secrets, proofs, or raw tool arguments. */
	readonly detail: string;
	/** Optional released asset coordinate. */
	readonly assetId: string | null;
}
