/** Marks a permanent cancellation target mismatch that must not poison the control queue. */
export class ConversationRunCancellationDenied extends Error
{
	/** Retains a stable safe reason without exposing the saved run. */
	public constructor(message: string)
	{
		super(message);
		this.name = "ConversationRunCancellationDenied";
	}
}
