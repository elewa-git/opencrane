/** Parent-owned intent to create or reopen the child for one exact root mention. */
export interface AgentThreadMentionIntent
{
	/** Parent group conversation coordinate. */
	readonly parentConversationId: string;
	/** Exact root `@agent` message coordinate. */
	readonly parentMessageId: string;
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
