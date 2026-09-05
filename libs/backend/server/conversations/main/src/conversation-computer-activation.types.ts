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

/** Immutable projection coordinates needed to locate one computer aggregate. */
export interface ConversationComputerActivationProjection
{
	/** Identifies the represented agent identity. */
	readonly agentIdentityId: string;
	/** Identifies the release-admitted computer profile. */
	readonly profileRevisionId: string;
}

/** Narrow PostgreSQL lookup used before computer history can be addressed. */
export interface ConversationComputerActivationProjectionRepository
{
	/** Resolve exact coordinates or null for a foreign/non-agent conversation. */
	resolve(command: ConversationComputerActivationCommand): Promise<ConversationComputerActivationProjection | null>;
}

/** Release-owned realization policy supplied to activation authority. */
export interface ConversationComputerActivationProfile
{
	/** Immutable image/profile revision admitted by the release. */
	readonly profileRevisionId: string;
	/** Profile name selected by the SandboxClaim. */
	readonly profileName: string;
	/** Warm pool fixed for this profile. */
	readonly warmPoolName: string;
	/** Isolated Agent Sandbox namespace. */
	readonly namespace: string;
	/** Maximum lifetime of one computer lease. */
	readonly leaseTtlMilliseconds: number;
}
