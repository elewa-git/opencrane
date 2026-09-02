import type { ConversationComputerHistory } from "./conversation-computers";
import type { ReservedConversationCreation } from "./conversation-creation-reservation.types";

/**
 * Establishes the first durable computer generation for an admitted Agent conversation.
 *
 * Direct and group conversations intentionally have no computer. Agent retries reuse the frozen
 * reservation identifiers and timestamps, then prove the exact pending generation if KurrentDB
 * accepted the atomic append before its response was lost.
 */
export interface ConversationComputerCreationActivationAuthority
{
	/** Provisions or confirms the one first claimed generation for this history-anchored reservation. */
	ensure(reservation: ReservedConversationCreation): Promise<void>;
}

/** Supplies the narrow history methods that atomically write or prove a first computer generation. */
export interface ConversationComputerCreationActivationAuthorityDependencies
{
	/** Writes the atomic computer and activation records, then loads a matching response-lost retry. */
	readonly history: Pick<ConversationComputerHistory, "load" | "provisionAndRequestActivation">;
	/** Supplies the server instant used when an uncommitted initial lease must be refreshed after an outage. */
	readonly clock: ConversationComputerCreationActivationClock;
}

/** Supplies the server-owned clock used to begin a first lease only when it can still be activated. */
export interface ConversationComputerCreationActivationClock
{
	/** Returns the current server time immediately before the atomic first-generation append. */
	now(): Date;
}
