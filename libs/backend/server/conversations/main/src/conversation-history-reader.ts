import { ___ConversationCreatedSchema, ___ConversationEntrySchema, type ConversationCreated, type ConversationEntry } from "@opencrane/contracts";
import { HistoryExpectedRevisions, type HistoryRecordedEvent, type HistoryStore } from "@opencrane/backend/server/infra/history-store";

import type { ConversationCreationReadCommand, ConversationHistoryReadCommand, ConversationHistoryReadResult, CurrentConversationHistory } from "./conversation-history-reader.types";

/** Names the sole versioned event that this reader exposes as a participant-visible entry. */
const _CONVERSATION_ENTRY_EVENT_TYPE = "opencrane.conversation-entry.v1";
/** Names the lifecycle anchor that must occupy revision zero before entries can exist. */
const _CONVERSATION_CREATED_EVENT_TYPE = "opencrane.conversation-created.v1";
/** Recognizes event identifiers that are also valid durable idempotency keys. */
const _UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Reads and validates finite participant-visible history from one KurrentDB conversation stream.
 *
 * An authorized conversation transport calls this after it has evaluated current PostgreSQL membership
 * and visibility. ADR 0016 assigns ordered participant history to KurrentDB, so malformed stream data
 * is an integrity failure rather than a reason to read a relational fallback or projection.
 *
 * @see ConversationHistoryAuthority for the matching server-authorized append envelope.
 */
export class ConversationHistoryReader
{
	/** Connects the reader to the checked HistoryStore read ports without granting append access. */
	public constructor(private readonly historyStore: Pick<HistoryStore, "readHead" | "readStream">) {}

	/**
	 * Validates the complete stream from revision zero, then returns the requested participant entries in revision order.
	 *
	 * The reader always checks `ConversationCreated` before it filters `fromRevision`; otherwise a
	 * caller could read a later entry without proving that the stream was created by this authority.
	 *
	 * @param command - Supplies trusted silo and conversation coordinates plus an optional inclusive revision.
	 * @returns The derived stream, its validated head, and entries whose envelope and coordinates match.
	 * @throws {Error} Rejects malformed coordinates, noncontiguous history, or any foreign or malformed event.
	 */
	public async read(command: ConversationHistoryReadCommand): Promise<ConversationHistoryReadResult>
	{
		// 1. Derive one stream before reading so caller-provided data cannot widen the history scope.
		const streamName = _StreamName(command);
		const request = { streamName };
		const entries: ConversationEntry[] = [];
		let expectedRevision = 0n;

		// 2. Check every immutable envelope before exposing its entry to a participant transport.
		for await (const event of this.historyStore.readStream(request))
		{
			const validated = _ValidatedEvent(event, command, streamName, expectedRevision);
			if (validated.entry !== null && (command.fromRevision === undefined || event.revision >= command.fromRevision))
				entries.push(validated.entry);
			expectedRevision += 1n;
		}

		// 3. Return the finite ordered stream result without constructing a relational or projection fallback.
		return { streamName, revision: expectedRevision === 0n ? null : expectedRevision - 1n, entries };
	}

	/**
	 * Reads the immutable revision-zero creation record after validating the complete stream.
	 *
	 * A history projector must call this before it writes relational conversation rows, participants,
	 * or grants. Reading every event makes a damaged tail an integrity failure rather than allowing
	 * a projection to use an anchor from a stream whose later records cannot be trusted.
	 *
	 * @param command - Supplies server-derived silo and conversation coordinates for the creation anchor.
	 * @returns The validated `ConversationCreated@0` payload for this conversation.
	 * @throws {Error} Rejects an absent stream, an invalid creation record, or any malformed stream event.
	 */
	public async readCreation(command: ConversationCreationReadCommand): Promise<ConversationCreated>
	{
		// 1. Derive one stream before reading so a projection cannot widen its history scope.
		const streamName = _StreamName(command);
		const request = { streamName };
		let expectedRevision = 0n;
		let created: ConversationCreated | null = null;

		// 2. Validate the complete stream before returning its revision-zero creation record.
		for await (const event of this.historyStore.readStream(request))
		{
			const validated = _ValidatedEvent(event, command, streamName, expectedRevision);
			if (validated.created !== null)
				created = validated.created;
			expectedRevision += 1n;
		}

		// 3. Reject an absent stream so a projection cannot invent relational state without history.
		if (created === null)
			throw new Error("Conversation history creation read requires a creation event at revision zero");
		return created;
	}

	/**
	 * Replays the complete current conversation stream and verifies its head did not move.
	 *
	 * ConversationComputer command admission uses the returned condition with HistoryStore.appendAtomic.
	 * It therefore cannot authorize an elicitation against a stale transcript and append it after a
	 * concurrent participant event changed the current conversation.
	 *
	 * @param command - Supplies trusted silo and conversation coordinates for the complete stream.
	 * @returns Every validated current entry and the exact later append condition for its checked head.
	 * @throws {Error} Rejects malformed history, a missing event before a reported head, or a changed head.
	 */
	public async readCurrent(command: ConversationHistoryReadCommand): Promise<CurrentConversationHistory>
	{
		if (command.fromRevision !== undefined)
			throw new Error("Conversation history current read cannot start after the immutable first entry");
		const current = await this.read(command);
		const head = await this.historyStore.readHead(current.streamName);
		if (head.streamName !== current.streamName || head.revision !== current.revision)
			throw new Error("Conversation history changed while loading its current state");
		return {
			...current,
			expectedRevision: head.revision ?? HistoryExpectedRevisions.NoStream,
		};
	}
}

/** Validates trusted command coordinates and derives the only stream that this reader may request. */
function _StreamName(command: ConversationCreationReadCommand | ConversationHistoryReadCommand): string
{
	if (!_Identifier(command.siloId))
		throw new Error("Conversation history read requires a server-provided silo identifier");
	if (!_Identifier(command.conversationId))
		throw new Error("Conversation history read requires a server-provided conversation identifier");
	if ("fromRevision" in command && command.fromRevision !== undefined && command.fromRevision < 0n)
		throw new Error("Conversation history read requires a nonnegative starting revision");
	return `conversation-${command.conversationId}`;
}

/** Validates one recorded event before the reader returns its participant-visible entry. */
function _ValidatedEvent(event: HistoryRecordedEvent, command: ConversationCreationReadCommand | ConversationHistoryReadCommand, streamName: string, expectedRevision: bigint): { readonly created: ConversationCreated | null; readonly entry: ConversationEntry | null }
{
	if (event.streamName !== streamName)
		throw new Error("Conversation history read received an event from a different stream");
	if (event.revision !== expectedRevision)
		throw new Error("Conversation history read received a noncontiguous stream revision");
	if (event.metadata.siloId !== command.siloId)
		throw new Error("Conversation history read received an event from a different silo");
	if (event.metadata.conversationId !== command.conversationId)
		throw new Error("Conversation history read received an event for a different conversation");
	if (event.revision === 0n)
		return { created: _ValidatedCreation(event, command), entry: null };
	if (event.type !== _CONVERSATION_ENTRY_EVENT_TYPE)
		throw new Error("Conversation history read received an unsupported event type");
	const entry = ___ConversationEntrySchema.safeParse(event.data.entry);
	if (!entry.success)
		throw new Error("Conversation history read received an invalid participant-visible entry");
	if (entry.data.conversationId !== command.conversationId)
		throw new Error("Conversation history read entry belongs to a different conversation");
	if (entry.data.position !== event.revision.toString())
		throw new Error("Conversation history read entry position does not match its stream revision");
	if (entry.data.id !== entry.data.idempotencyKey || !_UUID_PATTERN.test(entry.data.id))
		throw new Error("Conversation history read received an entry with an invalid idempotency key");
	if (event.id !== entry.data.id || event.metadata.causationId !== entry.data.causationId || event.metadata.correlationId !== entry.data.correlationId || event.metadata.idempotencyKey !== entry.data.idempotencyKey)
		throw new Error("Conversation history read received an entry that does not match its envelope");
	return { created: null, entry: entry.data };
}

/** Validates the required immutable revision-zero creation record without exposing it as a participant entry. */
function _ValidatedCreation(event: HistoryRecordedEvent, command: ConversationCreationReadCommand | ConversationHistoryReadCommand): ConversationCreated
{
	if (event.type !== _CONVERSATION_CREATED_EVENT_TYPE)
		throw new Error("Conversation history read requires a creation event at revision zero");
	const created = ___ConversationCreatedSchema.safeParse(event.data.created);
	if (!created.success)
		throw new Error("Conversation history read received an invalid creation event");
	if (created.data.conversationId !== command.conversationId)
		throw new Error("Conversation history creation belongs to a different conversation");
	if (event.metadata.idempotencyKey !== event.id || !_UUID_PATTERN.test(event.id))
		throw new Error("Conversation history read received a creation event with an invalid idempotency key");
	return created.data;
}

/** Checks a trusted identifier without altering the coordinate used to derive a stream name. */
function _Identifier(value: string): boolean
{
	return value.trim().length > 0 && value === value.trim();
}
