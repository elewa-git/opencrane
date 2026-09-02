import type { ConversationCaller } from "../types/conversation-caller.types";

import type { ConversationComputerParticipantInputAuthor, ConversationComputerParticipantInputResult } from "./conversation-computer-participant-input-authority.types";

/** Carries the UUID retry key and text accepted by the fresh participant-input transport. */
export interface ConversationComputerParticipantInputRequest
{
	/** Names the immutable history entry that this browser retry must reuse. */
	readonly inputId: string;
	/** Supplies one bounded text body for the target single-turn input contract. */
	readonly text: string;
}

/** Holds the current PostgreSQL facts that may authorize one history append. */
export interface AuthorizedConversationComputerParticipantInput
{
	/** Names the creation-bound computer whose command worker will consume this input. */
	readonly computerId: string;
	/** Captures the human identity facts that become immutable history metadata. */
	readonly author: ConversationComputerParticipantInputAuthor;
}

/** Resolves current authority immediately before immutable participant input enters history. */
export interface ConversationComputerParticipantInputAuthorizer
{
	/**
	 * Rechecks membership, participant access, conversation mode, and the `Use` decision.
	 *
	 * The implementation returns the creation-bound computer and the server-owned human display facts
	 * only when it recorded the current protected-action decision. It must return `null` rather than
	 * disclosing which current condition was unavailable.
	 */
	authorize(caller: ConversationCaller, conversationId: string, request: ConversationComputerParticipantInputRequest): Promise<AuthorizedConversationComputerParticipantInput | null>;
}

/** Lets a public transport distinguish a new history append from a response-lost retry. */
export type ConversationComputerParticipantInputAdmissionResult = ConversationComputerParticipantInputResult | null;
