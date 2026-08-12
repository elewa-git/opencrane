/** Browser-safe Agent-thread gateway error categories. */
export enum AgentThreadGatewayErrorKinds
{
	/** Missing, foreign, and never-authorized routes collapse to one response. */
	Unavailable = "unavailable",
	/** A previously authorized route observed participant access loss. */
	AccessChanged = "access_changed",
	/** A temporary transport failure may be retried from the accepted cursor. */
	Recoverable = "recoverable"
}

/** Typed gateway failure carrying no raw transport or provider detail. */
export class AgentThreadGatewayError extends Error
{
	/** Stable browser-safe category. */
	public readonly kind: AgentThreadGatewayErrorKinds;

	/** Create one display-safe gateway error. */
	public constructor(kind: AgentThreadGatewayErrorKinds, message: string)
	{
		super(message);
		this.name = "AgentThreadGatewayError";
		this.kind = kind;
	}
}
