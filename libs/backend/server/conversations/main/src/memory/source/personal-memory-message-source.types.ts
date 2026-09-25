import type { PersonalMemoryOperationMessageSource } from "@opencrane/backend/agents/personal/memory";
import type { ConversationCaller } from "../../authorization/conversation-caller.types";

/** Carries transient source text beside the secret-free coordinates saved by memory admission. */
export interface PersonalMemoryMessageSourceRead
{
	/** Immutable coordinates that may cross into the personal-memory operation transaction. */
	readonly source: PersonalMemoryOperationMessageSource;
	/** Decrypted message text held only for the provider request that follows admission. */
	readonly text: string;
	/** Complete UTF-8 digest that the worker must match before sending the text to the gateway. */
	readonly contentDigest: string;
}

/** Reads one caller-authored message without allowing a delayed workflow to select a new source. */
export interface PersonalMemoryMessageSourceReader
{
	/**
	 * Reads one exact message position and decrypts its sole text block after current access checks.
	 * @param caller - Authenticated silo, subject, and principal coordinates from the server.
	 * @param conversationId - Conversation stream that owns the message.
	 * @param messageId - Immutable message identifier within that stream.
	 * @param messagePosition - Immutable KurrentDB position used to bound the read.
	 * @param signal - Optional caller cancellation signal; a ten-second bound is always applied.
	 * @returns Transient plaintext plus the exact coordinates and digest, or null when the source is not admissible.
	 */
	read(caller: ConversationCaller, conversationId: string, messageId: string, messagePosition: bigint, signal?: AbortSignal): Promise<PersonalMemoryMessageSourceRead | null>;
}

/** Revalidates saved source coordinates inside the command transaction that owns the operation row. */
export interface PersonalMemoryMessageSourceRevalidator
{
	/**
	 * Checks current conversation Read access and the coordinate-bound encrypted payload row.
	 * @param caller - Authenticated silo and subject used by the surviving conversation authority.
	 * @param source - Secret-free coordinates read before this transaction began.
	 * @returns Whether the source remains the same authorized message payload.
	 */
	revalidate(caller: ConversationCaller, source: PersonalMemoryOperationMessageSource): Promise<boolean>;
}
