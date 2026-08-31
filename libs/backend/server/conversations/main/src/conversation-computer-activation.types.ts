/**
 * Carries one stream-bound computer activation request after the listener validates its delivery.
 *
 * The silo queue, computer, conversation, and generation stay together so the authority can reject
 * a stale wake request rather than applying it to a replacement computer lease.
 */
export interface ConversationComputerActivationCommand
{
	/** Identifies the silo-local activation queue. */
	readonly siloId: string;
	/** Identifies the logical computer to wake. */
	readonly computerId: string;
	/** Identifies the computer's one owning conversation. */
	readonly conversationId: string;
	/** Fences this wake request to one expected computer generation. */
	readonly generation: number;
}

/**
 * Directs the listener to remove a valid but terminal activation failure from its active queue.
 *
 * Parking preserves the delivery and its operator-facing reason for repair instead of retrying an
 * outcome the authority has already classified as terminal.
 */
export interface ConversationComputerActivationParked
{
	/** Identifies the persistent-subscription action for this terminal activation outcome. */
	readonly action: "park";
	/** Explains the terminal outcome to the operator inspecting the parked delivery. */
	readonly reason: string;
}

/**
 * Lists every authority outcome a persistent activation delivery can resolve without a retry.
 *
 * Activated, idempotent, and denied outcomes acknowledge the delivery. A parked outcome moves it
 * aside with an operator-facing reason; an authority exception is the separate transient path.
 */
export type ConversationComputerActivationOutcome = "activated" | "idempotent" | "denied" | ConversationComputerActivationParked;

/**
 * Decides whether a validated computer generation can activate.
 *
 * The listener supplies a stream-bound command and maps this result to the persistent queue action;
 * the authority owns current computer, lease, and Agent Sandbox claim decisions.
 */
export interface ConversationComputerActivationAuthority
{
	/** Activates the exact durable computer generation or returns its terminal queue outcome. */
	activate(command: ConversationComputerActivationCommand): Promise<ConversationComputerActivationOutcome>;
}
