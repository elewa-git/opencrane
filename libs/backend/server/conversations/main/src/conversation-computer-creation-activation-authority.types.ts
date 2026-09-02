import type { ConversationComputerHistory } from "./conversation-computers";
import type { ReservedConversationCreation } from "./conversation-creation-reservation.types";

/**
 * Establishes the first durable computer generation for an admitted Agent conversation.
 *
 * Creation calls this after the conversation anchor and relational projection are confirmed. Direct
 * and group conversations intentionally produce no computer. Agent retries reuse the reservation's
 * frozen identifiers and timestamps, then prove the stored pending generation if KurrentDB accepted
 * the atomic append before its response was lost. This authority creates lifecycle history and
 * activation work; the Agent Sandbox controller receives the resulting claim request later.
 */
export interface ConversationComputerCreationActivationAuthority
{
	/**
	 * Provisions or confirms the first claimed generation for this history-anchored reservation.
	 * Called by: {@link HistoryAnchoredConversationCreationService} after anchor confirmation.
	 * @param reservation - Carries the frozen Agent identity, profile, computer, event, and lease coordinates.
	 * @returns Resolves after the computer stream and its activation work are established or recovered.
	 * @throws {Error} When an Agent reservation is incomplete or existing history conflicts with it.
	 */
	ensure(reservation: ReservedConversationCreation): Promise<void>;
}

/**
 * Supplies the narrow history methods that write or prove a first computer generation.
 *
 * The activation authority needs no claim client or database port: KurrentDB is the boundary that
 * records the computer and hands its activation event to the separately owned worker.
 */
export interface ConversationComputerCreationActivationAuthorityDependencies
{
	/** Writes the atomic computer and activation records, then loads a matching response-lost retry. */
	readonly history: Pick<ConversationComputerHistory, "load" | "provisionAndRequestActivation">;
	/** Supplies the server instant used when an uncommitted initial lease must be refreshed after an outage. */
	readonly clock: ConversationComputerCreationActivationClock;
}

/** Supplies the server-owned clock used to replace a lease window that expired before its first append. */
export interface ConversationComputerCreationActivationClock
{
	/** Returns the current server time immediately before the atomic first-generation append. */
	now(): Date;
}
