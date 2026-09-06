/** Names the exact lease whose turn activity is being measured. */
export interface ConversationComputerActivityCommand
{
	/** Identifies the owning silo. */
	readonly siloId: string;
	/** Identifies the logical computer. */
	readonly computerId: string;
	/** Fences the measurement to one lease generation. */
	readonly generation: number;
	/** Identifies the exact lease whose turns count as activity. */
	readonly leaseId: string;
}

/**
 * Reports the last durable turn activity recorded for one lease.
 *
 * `busy` is true while a bootstrapped turn has not settled, so the lifecycle never treats a
 * computer that is still executing as idle even if its last durable event is old.
 */
export interface ConversationComputerActivity
{
	/** Records when KurrentDB accepted the newest turn bootstrap or settlement for this lease. */
	readonly lastActivityAt: Date;
	/** States whether a bootstrapped turn is still unsettled. */
	readonly busy: boolean;
}

/**
 * Reads durable turn activity so idleness is measured from real work, not from lease transitions.
 *
 * Called by: {@link ConversationComputerLifecycleAuthority} and the lifecycle due enumerator.
 */
export interface ConversationComputerActivityReader
{
	/** Returns the newest activity for the lease, or null when the lease has never run a turn. */
	lastActivity(command: ConversationComputerActivityCommand): Promise<ConversationComputerActivity | null>;
}
