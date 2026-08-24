/**
 * Carries the browser-safe result of a refused or unsettled participant message command.
 *
 * The workspace gateway branches on `accessChanged` to purge its selected projection and on
 * `closed` to adopt the server-proven closed lifecycle. Every other failure retains only fixed
 * retry-safe copy, so a transport error never exposes server internals in the UI.
 *
 * Called by: `OpenCraneConversationEventStream` and `OpenCraneConversationWorkspaceGateway`.
 */
export class ConversationEventStreamMessageError extends Error
{
	/** Whether the server proved that the selected conversation is no longer visible. */
	public readonly accessChanged: boolean;
	/** Whether the server proved that the selected conversation is permanently closed. */
	public readonly closed: boolean;

	/** Creates the fixed browser-safe failure surfaced through the event-stream port. */
	public constructor(denial?: string)
	{
		super("OpenCrane could not submit that message. Try again.");
		this.accessChanged = denial === "conversation_unavailable";
		this.closed = denial === "conversation_closed";
	}
}
