import type { ConversationReplayCursor } from "@opencrane/contracts";

import type { ConversationProjectionEventRow } from "./conversation-event-projector.types.js";

/**
 * Names the authority result returned with one page of conversation events.
 *
 * The stream must distinguish an empty authorised page from lost access. These values cross the
 * reader-to-stream boundary, so add new values deliberately and make the stream fail closed when it
 * does not recognise one.
 *
 * Called by: `__StreamConversationProjection` and the server conversation replay repositories.
 */
export enum ConversationProjectionReadStatuses
{
	/** The participant may read the conversation, even when the returned page is empty. */
	Authorized = "authorized",
	/** The conversation is absent or the participant can no longer read it; callers must end the stream. */
	RevokedOrMissing = "revoked_or_missing",
}

/**
 * Selects one authorised page after an optional durable cursor.
 *
 * Coordinates come from authenticated server context. The reader must check them together and must
 * never infer a silo or participant from the conversation identifier alone.
 *
 * Called by: `__StreamConversationProjection`.
 */
export interface ReadConversationProjectionCommand
{
	/** Conversation selected by trusted request context. */
	readonly conversationId: string;
	/** Silo selected by trusted request context. */
	readonly siloId: string;
	/** Participant selected by trusted request context. */
	readonly subjectId: string;
	/** Last emitted position, or `null` for the first snapshot. */
	readonly cursor: ConversationReplayCursor | null;
	/** Server-owned upper bound for one page. */
	readonly limit: number;
}

/**
 * Returns one canonical page and the participant's authority state from the same read snapshot.
 *
 * Called by: `__StreamConversationProjection`.
 */
export interface ConversationProjectionReadResult
{
	/** Authority decision made in the same snapshot as `rows`. */
	readonly status: ConversationProjectionReadStatuses;
	/** Canonical timeline rows in ascending durable position order. */
	readonly rows: readonly ConversationProjectionEventRow[];
}

/**
 * Supplies authorised canonical pages without exposing a database or transport implementation.
 *
 * A server adapter normally implements this port with a transaction that checks membership and reads
 * the timeline together. In-memory implementations keep the stream deterministic in tests.
 *
 * Called by: `__StreamConversationProjection`.
 */
export interface ConversationProjectionReader
{
	/**
	 * Checks current authority and reads one ordered page.
	 *
	 * @param command Trusted conversation coordinates and the resume position.
	 * @returns The authority result and zero or more canonical rows from one snapshot.
	 */
	readAuthorized(command: ReadConversationProjectionCommand): Promise<ConversationProjectionReadResult>;
}
