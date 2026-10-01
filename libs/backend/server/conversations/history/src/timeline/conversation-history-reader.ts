import { ___ConversationEntrySchema, type ConversationEntry } from "@opencrane/contracts";
import { type HistoryRecordedEvent, type HistoryStore } from "@opencrane/backend/server/infra/history-store";

import { ConversationHistoryModes, type ConversationHistoryGenesis, type ConversationHistoryGenesisReadCommand, type ConversationHistoryReadCommand, type ConversationHistoryReadResult } from "./conversation-history-reader.types";
import { _ParseGroupChildOrigin } from "./conversation-genesis.validator";

/** Names the sole versioned event that this reader exposes as a participant-visible entry. */
const _CONVERSATION_ENTRY_EVENT_TYPE = "opencrane.conversation-entry.v1";
/** Names the immutable revision-zero event that establishes stream ownership. */
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
	/** Connects the reader to the stream-only HistoryStore port without granting append access. */
	public constructor(private readonly historyStore: Pick<HistoryStore, "readStream">) {}

	/**
	 * Reads one validated stream range and returns only its participant-visible entries in revision order.
	 *
	 * @param command - Supplies trusted silo and conversation coordinates plus an optional inclusive revision.
	 * @returns The exact derived stream name and entries whose envelope and entry coordinates all match.
	 * @throws {Error} Rejects malformed coordinates, noncontiguous history, or any foreign or malformed event.
	 */
	public async read(command: ConversationHistoryReadCommand): Promise<ConversationHistoryReadResult>
	{
		if (command.maxCount !== undefined)
			return this._readPage(command);
		// 1. Derive one stream before reading so caller-provided data cannot widen the history scope.
		const streamName = _StreamName(command);
		const request = { streamName };
		const entries: ConversationEntry[] = [];
		let expectedRevision = 0n;
		let genesisSeen = false;
		let genesis: ConversationHistoryGenesis | null = null;

		// 2. Check every immutable envelope before exposing its entry to a participant transport.
		for await (const event of this.historyStore.readStream(request))
		{
			if (event.revision === 0n)
			{
				genesis = _ValidatedGenesis(event, command, streamName);
				genesisSeen = true;
				expectedRevision = 1n;
				continue;
			}
			if (!genesisSeen)
				throw new Error("Conversation history read requires an immutable genesis event");
			const entry = _ValidatedEntry(event, command, streamName, expectedRevision);
			if (command.fromRevision === undefined || event.revision >= command.fromRevision)
				entries.push(entry);
			expectedRevision += 1n;
		}
		if (!genesisSeen || genesis === null)
			throw new Error("Conversation history read requires an immutable genesis event");

		// 3. Return the finite ordered stream result without constructing a relational or projection fallback.
		return { streamName, genesis, entries };
	}

	/** Reads only the validated revision-zero ownership record for creation retries and bounded history. */
	public async readGenesis(command: ConversationHistoryGenesisReadCommand): Promise<ConversationHistoryGenesis>
	{
		command.signal?.throwIfAborted();
		const streamName = _StreamName(command);
		if (!Number.isSafeInteger(command.maximumBytes) || command.maximumBytes < 1)
			throw new Error("Conversation genesis requires a positive byte limit");
		let genesis: ConversationHistoryGenesis | null = null;
		for await (const event of this.historyStore.readStream({ streamName, fromRevision: 0n, maxCount: 1, signal: command.signal }))
		{
			_AssertEventSize(event, command.maximumBytes!);
			genesis = _ValidatedGenesis(event, command, streamName);
		}
		if (genesis === null)
			throw new Error("Conversation history read requires an immutable genesis event");
		command.signal?.throwIfAborted();
		return genesis;
	}

	/** Checks immutable ownership once, then validates only the bounded requested revision range. */
	private async _readPage(command: ConversationHistoryReadCommand): Promise<ConversationHistoryReadResult>
	{
		const streamName = _StreamName(command);
		if (!Number.isSafeInteger(command.maxCount) || command.maxCount! < 1 || !Number.isSafeInteger(command.maximumBytes) || command.maximumBytes! < 1)
			throw new Error("Conversation history page requires positive count and byte limits");
		const genesis = await this.readGenesis({ siloId: command.siloId, conversationId: command.conversationId, maximumBytes: command.maximumBytes!, signal: command.signal });
		const fromRevision = command.fromRevision === undefined || command.fromRevision === 0n ? 1n : command.fromRevision;
		const entries: ConversationEntry[] = [];
		let expectedRevision = fromRevision;
		for await (const event of this.historyStore.readStream({ streamName, fromRevision, maxCount: command.maxCount, signal: command.signal }))
		{
			command.signal?.throwIfAborted();
			_AssertEventSize(event, command.maximumBytes!);
			entries.push(_ValidatedEntry(event, command, streamName, expectedRevision));
			expectedRevision += 1n;
			if (entries.length >= command.maxCount!)
				break;
		}
		command.signal?.throwIfAborted();
		return { streamName, genesis, entries };
	}
}

/** Rejects oversized stored content before a bounded reader accumulates it. */
function _AssertEventSize(event: HistoryRecordedEvent, maximumBytes: number): void
{
	if (Buffer.byteLength(JSON.stringify({ data: event.data, metadata: event.metadata }), "utf8") > maximumBytes)
		throw new Error("Conversation history event exceeds its byte limit");
}

/** Validates revision zero before any participant-visible entry can be exposed. */
function _ValidatedGenesis(event: HistoryRecordedEvent, command: ConversationHistoryReadCommand, streamName: string): ConversationHistoryGenesis
{
	if (event.streamName !== streamName || event.revision !== 0n || event.type !== _CONVERSATION_CREATED_EVENT_TYPE)
		throw new Error("Conversation history read received an invalid genesis event");
	if (event.metadata.siloId !== command.siloId || event.metadata.conversationId !== command.conversationId)
		throw new Error("Conversation history read received genesis for different coordinates");
	const value = (event.data as { readonly genesis?: unknown }).genesis;
	if (typeof value !== "object" || value === null || Array.isArray(value))
		throw new Error("Conversation history read received malformed genesis data");
	const genesis = value as ConversationHistoryGenesis;
	if (genesis.schemaVersion !== 1 || genesis.siloId !== command.siloId || genesis.conversationId !== command.conversationId || !Object.values(ConversationHistoryModes).includes(genesis.mode as ConversationHistoryModes) || !_Identifier(genesis.createdByPrincipalId) || !Number.isFinite(Date.parse(genesis.createdAt)))
		throw new Error("Conversation history read received invalid genesis coordinates");
	if ((genesis.mode === ConversationHistoryModes.AgentSession) !== _Identifier(genesis.agentServiceId ?? ""))
		throw new Error("Conversation history read received an invalid genesis service binding");
	if (genesis.origin !== undefined && (genesis.mode !== ConversationHistoryModes.AgentSession || _ParseGroupChildOrigin(genesis.origin, genesis.conversationId) === null))
		throw new Error("Conversation history read received an invalid child origin");
	return genesis;
}

/** Validates trusted command coordinates and derives the only stream that this reader may request. */
function _StreamName(command: ConversationHistoryReadCommand): string
{
	if (!_Identifier(command.siloId))
		throw new Error("Conversation history read requires a server-provided silo identifier");
	if (!_Identifier(command.conversationId))
		throw new Error("Conversation history read requires a server-provided conversation identifier");
	if (command.fromRevision !== undefined && command.fromRevision < 0n)
		throw new Error("Conversation history read requires a nonnegative starting revision");
	return `conversation-${command.conversationId}`;
}

/** Validates one recorded event before the reader returns its participant-visible entry. */
function _ValidatedEntry(event: HistoryRecordedEvent, command: ConversationHistoryReadCommand, streamName: string, expectedRevision: bigint): ConversationEntry
{
	if (event.streamName !== streamName)
		throw new Error("Conversation history read received an event from a different stream");
	if (event.revision !== expectedRevision)
		throw new Error("Conversation history read received a noncontiguous stream revision");
	if (event.type !== _CONVERSATION_ENTRY_EVENT_TYPE)
		throw new Error("Conversation history read received an unsupported event type");
	if (event.metadata.siloId !== command.siloId)
		throw new Error("Conversation history read received an event from a different silo");
	if (event.metadata.conversationId !== command.conversationId)
		throw new Error("Conversation history read received an event for a different conversation");
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
	return entry.data;
}

/** Checks a trusted identifier without altering the coordinate used to derive a stream name. */
function _Identifier(value: string): boolean
{
	return value.trim().length > 0 && value === value.trim();
}
