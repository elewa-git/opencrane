import type { AgentThreadSummaryTarget } from "@opencrane/state/conversation/agent-threads";

/** One display-safe Agent service that an ordinary group composer may target. */
export interface AgentThreadAgentOption
{
	/** Stable service coordinate submitted only as the atomic message target. */
	readonly agentServiceId: string;
	/** Display-safe service name shown in the mention menu. */
	readonly label: string;
}

/** Selected Agent target returned to the ordinary group composer before it submits. */
export interface AgentThreadMentionTarget
{
	/** Stable service coordinate sent together with the ordinary group message. */
	readonly agentServiceId: string;
	/** Display-safe selected label retained in the controlled composer. */
	readonly label: string;
}

/** Parent-owned intent to open one exact child route and remember restoration coordinates. */
export interface AgentThreadOpenIntent
{
	/** Parent group conversation coordinate. */
	readonly parentConversationId: string;
	/** Child Agent-session conversation coordinate. */
	readonly childConversationId: string;
	/** Root message that should regain focus on return. */
	readonly parentMessageId: string;
	/** Opaque parent scroll anchor captured before navigation. */
	readonly parentScrollAnchor: string;
	/** Canonical child focus target derived from current durable state. */
	readonly target: AgentThreadSummaryTarget;
}

/** Route-wide purge request for every projection owned outside the Agent-thread store. */
export interface AgentThreadProjectionPurgeIntent
{
	/** Monotonic purge generation for idempotent route-coordinator handling. */
	readonly generation: number;
	/** Exact parent route being removed from browser state. */
	readonly parentConversationId: string;
	/** Exact child route being removed from browser state. */
	readonly childConversationId: string;
}
