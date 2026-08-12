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
}
