import type { ElicitationRequestEntry } from "@opencrane/contracts";
import type { ReadOpenConversationInterruptsCommand } from "@opencrane/backend/conversations/projection";

/**
 * Resolves an authenticated browser subject to its current participant record.
 *
 * Called by: `ConversationComputerElicitationInterruptReader`. `null` means that the subject no
 * longer has participant access and must receive no protected request detail.
 */
export interface ConversationComputerElicitationInterruptParticipantResolver
{
	/**
	 * Resolves the current participant the authenticated subject may act as.
	 * @param command - Provides the trusted socket subject and conversation coordinates.
	 * @returns The participant id, or `null` when participation has ended.
	 */
	resolve(command: ReadOpenConversationInterruptsCommand): Promise<{ readonly participantId: string } | null>;
}

/**
 * Resolves the one current computer execution that may expose an actionable participant request.
 *
 * Called by: `ConversationComputerElicitationInterruptReader`. The app-owned implementation
 * derives this from `ConversationComputerHistory`; it never accepts a computer or execution id
 * from the browser or the history entry being rendered.
 */
export interface ConversationComputerElicitationInterruptExecutionResolver
{
	/**
	 * Returns the active computer execution and lease fence for a conversation.
	 * @param command - Carries the app-selected silo and conversation coordinates.
	 * @returns The current execution fence, or `null` when no computer may expose requests.
	 */
	resolve(command: Pick<ReadOpenConversationInterruptsCommand, "siloId" | "conversationId">): Promise<{ readonly computerId: string; readonly executionId: string; readonly leaseGeneration: number } | null>;
}

/**
 * Reads the browser-safe request presentation after it verifies protected-payload ownership.
 *
 * Called by: `ConversationComputerElicitationInterruptReader`. The implementation verifies the
 * stored payload digest and request/participant ownership before it returns this presentation.
 */
export interface ConversationComputerElicitationInterruptPayloadReader
{
	/**
	 * Reads the request presentation that its addressed participant may render.
	 * @param command - Binds the verified request to its silo, conversation, and participant.
	 * @returns Browser-safe prompt text and a response schema after the payload checks pass.
	 */
	readRequestForParticipant(command: { readonly siloId: string; readonly conversationId: string; readonly participantId: string; readonly request: ElicitationRequestEntry }): Promise<DisplayedConversationComputerElicitationRequest>;
}

/**
 * Holds the browser-safe fields of one verified protected elicitation request.
 *
 * This is deliberately smaller than the stored protected payload: it cannot return response
 * routing coordinates, credentials, or server-only tool arguments.
 */
export interface DisplayedConversationComputerElicitationRequest
{
	/** Gives the addressed participant the server-approved question or explanation. */
	readonly message: string;
	/** Gives the browser the server-approved schema for its response form. */
	readonly responseSchema: Readonly<Record<string, unknown>>;
}

/** Owns the server clock used to decide whether a request is still actionable. */
export interface ConversationComputerElicitationInterruptClock
{
	/** Returns the server time used for the request expiry boundary. */
	now(): Date;
}
