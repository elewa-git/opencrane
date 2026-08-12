/** Browser-safe categories for workspace transport failures. */
export enum ConversationWorkspaceGatewayErrorKinds
{
	/** A previously authorized conversation is no longer visible to the participant. */
	AccessChanged = "access_changed",
	/** A command conflicts with newer authoritative state. */
	Conflict = "conflict",
	/** The operation can be tried again without changing its meaning. */
	Recoverable = "recoverable",
	/** The requested workspace state is not available. */
	Unavailable = "unavailable"
}

/** Error carrying browser-safe copy without exposing response bodies. */
export class ConversationWorkspaceGatewayError extends Error
{
	/** Stable failure category used by store policy. */
	public readonly kind: ConversationWorkspaceGatewayErrorKinds;

	/** Build one display-safe workspace error. */
	public constructor(kind: ConversationWorkspaceGatewayErrorKinds, message: string)
	{
		super(message);
		this.name = "ConversationWorkspaceGatewayError";
		this.kind = kind;
	}
}
