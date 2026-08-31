import { WrongExpectedVersionError } from "@kurrent/kurrentdb-client";
import { ___ConversationEntrySchema } from "@opencrane/contracts";
import { HistoryExpectedRevisions, type HistoryStore } from "@opencrane/backend/server/infra/history-store";

import { ConversationHistoryAppendOutcomes, type ConversationHistoryAppendCommand, type ConversationHistoryAppendResult } from "./conversation-history-authority.types";

/** Recognizes event identifiers that can also serve as the entry idempotency key. */
const _UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Names the versioned HistoryStore event that carries a participant-visible conversation entry. */
const _CONVERSATION_ENTRY_EVENT_TYPE = "opencrane.conversation-entry.v1";

/**
 * Appends an already-authorized participant-visible entry to its KurrentDB conversation stream.
 *
 * ADR 0016 keeps memberships, grants, and deny rules in PostgreSQL, then records ordered participant history in
 * `conversation-{id}`. This class consequently accepts a server-stamped entry, derives the stream from its
 * coordinates, and never makes an authorization decision itself.
 *
 * @see BoundConversationWriter for the computer-specific boundary that stamps agent-authored entries.
 * @see https://github.com/kurrent-io/KurrentDB-Client-NodeJS/tree/v1.3.1 — the checked-append client API used by HistoryStore.
 */
export class ConversationHistoryAuthority
{
	/** Connects the authority to the append-only KurrentDB port without granting it stream reads. */
	public constructor(private readonly historyStore: Pick<HistoryStore, "append">) {}

	/**
	 * Validates and appends one server-stamped entry at the caller's observed conversation stream head.
	 *
	 * The authority derives the KurrentDB stream and envelope metadata from trusted command coordinates, then uses
	 * the entry's UUID idempotency key as the KurrentDB event identifier. It returns an expected-head conflict only
	 * for that stream; tests preserve foreign-stream conflicts and unavailable-store errors as exceptions.
	 * @param command - Supplies the server-authorized silo, conversation, head, and immutable entry.
	 * @returns A committed receipt or an expected-head conflict that requires fresh authorization.
	 * @throws {Error} Rejects invalid or mismatched coordinates and propagates non-concurrency failures.
	 */
	public async append(command: ConversationHistoryAppendCommand): Promise<ConversationHistoryAppendResult>
	{
		// 1. Validate coordinates before malformed data can enter the immutable history stream.
		const entry = _ValidatedEntry(command);
		// 2. Derive the stream from the command so an entry cannot redirect its own append.
		const streamName = `conversation-${command.conversationId}`;
		// 3. Return the stream's conflict for re-authorization and preserve every other store error.
		try
		{
			const receipt = await this.historyStore.append({ streamName, expectedRevision: command.expectedRevision, events: [{ id: entry.id, type: _CONVERSATION_ENTRY_EVENT_TYPE, data: { entry }, metadata: { siloId: command.siloId, conversationId: command.conversationId, causationId: entry.causationId, correlationId: entry.correlationId, idempotencyKey: entry.idempotencyKey } }] });
			return { outcome: ConversationHistoryAppendOutcomes.Appended, receipt };
		}
		catch (error)
		{
			if (error instanceof WrongExpectedVersionError && error.streamName === streamName)
				return { outcome: ConversationHistoryAppendOutcomes.ExpectedHeadConflict };
			throw error;
		}
	}
}

/** Validates all coordinates before the authority constructs an immutable KurrentDB event. */
function _ValidatedEntry(command: ConversationHistoryAppendCommand)
{
	// 1. Reject malformed command coordinates before they can name durable event metadata or a stream.
	if (!_Identifier(command.siloId))
		throw new Error("Conversation history append requires a server-provided silo identifier");
	if (!_Identifier(command.conversationId))
		throw new Error("Conversation history append requires a server-provided conversation identifier");
	if (!_ExpectedRevision(command.expectedRevision))
		throw new Error("Conversation history append requires a nonnegative expected revision");
	// 2. Cross-check the unnormalized server-stamped coordinates before schema parsing can normalize them.
	if (command.entry.conversationId !== command.conversationId)
		throw new Error("Conversation history append entry belongs to a different conversation");
	if (command.entry.id !== command.entry.idempotencyKey || !_UUID_PATTERN.test(command.entry.id))
		throw new Error("Conversation history append requires the entry UUID to be its idempotency key");
	if (command.entry.position !== _Position(command.expectedRevision))
		throw new Error("Conversation history append entry position does not match the expected revision");
	// 3. Validate the closed participant-visible union before it becomes an event payload.
	const result = ___ConversationEntrySchema.safeParse(command.entry);
	if (!result.success)
		throw new Error("Conversation history append requires a valid participant-visible entry");
	return result.data;
}

/** Checks an identifier without changing the coordinate that the authority will stamp. */
function _Identifier(value: string): boolean
{
	return value.trim().length > 0 && value === value.trim();
}

/** Checks the HistoryStore revisions that this authority can convert into an entry position. */
function _ExpectedRevision(value: HistoryExpectedRevisions.NoStream | bigint): boolean
{
	return value === HistoryExpectedRevisions.NoStream || value >= 0n;
}

/** Derives the position that follows the expected revision checked by the append. */
function _Position(expectedRevision: HistoryExpectedRevisions.NoStream | bigint): string
{
	if (expectedRevision === HistoryExpectedRevisions.NoStream)
		return "0";
	return (expectedRevision + 1n).toString();
}
