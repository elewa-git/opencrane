/** Marks a permanent Stop refusal that the durable activation consumer may acknowledge. */
export class ConversationComputerStopDenied extends Error
{
	/** Retains a stable safe reason without exposing protected state. */
	public constructor(message: string)
	{
		super(message);
		this.name = "ConversationComputerStopDenied";
	}
}
