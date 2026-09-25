import { isDeepStrictEqual } from "node:util";
import { WrongExpectedVersionError } from "@kurrent/kurrentdb-client";

import type { RoutineOccurrencePreparationReceipt } from "@opencrane/backend/server/agents/scheduling/contract";
import { ConversationComputerHistory } from "@opencrane/backend/server/conversations/computers";
import { ConversationHistoryReader, type ConversationHistoryAuthority } from "@opencrane/backend/server/conversations/history";
import { HistoryExpectedRevisions, type HistoryAppend, type HistoryStore } from "@opencrane/backend/server/infra/history-store";

import { _RoutineColdComputer, _RoutineEventId, _RoutineGenesis, _RoutineHistoryDigest, _RoutineInstructionEntry, _RoutineInstructionReceiptEvent, _RoutineInstructionStream } from "./routine-occurrence-history.mapper";
import type { RoutineOccurrenceHistoryRecord } from "./routine-occurrence-history.types";
import { _RoutineOccurrenceHistoryRecordSchema, _RoutineOccurrenceReadCoordinatesSchema } from "./routine-occurrence-history.validator";

/** Bounds the metadata read for a preparation receipt independently of encrypted instruction size. */
const _MAX_RECEIPT_BYTES = 131_072;

/**
 * Records the first service-authored instruction, genesis and cold computer together.
 *
 * This history adapter does not admit a routine, persist ciphertext or grant participants access.
 * Its caller must check current preparation authority, save the instruction encrypted under the
 * OpenCrane service author, and keep the conversation hidden until the audience transaction commits.
 * History never starts a turn; computer activation and root-run admission remain separate steps.
 */
export class RoutineOccurrenceHistory
{
	/** Validates both new genesis and the service-authored message before either is persisted. */
	private readonly authority: Pick<ConversationHistoryAuthority, "genesisAppend" | "entryAppend">;
	/** Reads the immutable conversation origin and instruction after uncertain writes. */
	private readonly reader: ConversationHistoryReader;
	/** Verifies the existing computer identity and profile without admitting a lease. */
	private readonly computers: ConversationComputerHistory;

	/** Uses only the existing history store, with no second database or activation engine. */
	public constructor(private readonly store: Pick<HistoryStore, "append" | "appendAtomic" | "readStream" | "readHead">, authority: Pick<ConversationHistoryAuthority, "genesisAppend" | "entryAppend">)
	{
		this.authority = authority;
		this.reader = new ConversationHistoryReader(store);
		this.computers = new ConversationComputerHistory(store);
	}

	/**
	 * Creates the complete initial history or returns the exact committed preparation receipt.
	 * @throws Error if a coordinate changed, history is partial, or storage cannot confirm the write.
	 */
	public async establish(input: RoutineOccurrenceHistoryRecord): Promise<RoutineOccurrencePreparationReceipt>
	{
		const record = _RoutineOccurrenceHistoryRecordSchema.parse(input);
		_RequireBoundedRecord(record);
		if (await this._recover(record))
		{
			return _PreparationReceipt(record);
		}
		const genesis = this.authority.genesisAppend(_RoutineGenesis(record), _RoutineEventId("genesis", record.conversationId));
		const message = this.authority.entryAppend({ siloId: record.siloId, conversationId: record.conversationId, expectedRevision: 0n, entry: _RoutineInstructionEntry(record) });
		const computerAppend = this.computers.initialAppend({ computer: _RoutineColdComputer(record), eventId: _RoutineEventId("computer", record.conversationId) });
		const appends: readonly HistoryAppend[] = [
			{ ...genesis, events: [...genesis.events, ...message.events] },
			computerAppend,
			{ streamName: _RoutineInstructionStream(record.conversationId), expectedRevision: HistoryExpectedRevisions.NoStream, events: [_RoutineInstructionReceiptEvent(record)] },
		];
		try
		{
			// All three streams must be new: no participant can observe an instruction without its origin.
			await this.store.appendAtomic({ expectedHeads: appends.map(append => ({ streamName: append.streamName, revision: HistoryExpectedRevisions.NoStream })), appends });
		}
		catch (error)
		{
			if (!(error instanceof WrongExpectedVersionError) || !appends.some(append => append.streamName === error.streamName))
			{
				throw error;
			}
		}
		// Recovery verifies actual stored evidence, not just a successful transport response.
		if (!(await this._recover(record)))
		{
			throw new Error("Routine occurrence history did not commit its complete preparation");
		}
		return _PreparationReceipt(record);
	}

	/**
	 * Reads a complete, checked instruction record for service-side admission and replay.
	 * @returns Null before preparation; this grants no browser or participant access.
	 * @throws Error for malformed, foreign, partial or changed history.
	 */
	public async readRecord(siloId: string, conversationId: string): Promise<RoutineOccurrenceHistoryRecord | null>
	{
		_RoutineOccurrenceReadCoordinatesSchema.parse({ siloId, conversationId });
		const streamName = _RoutineInstructionStream(conversationId);
		let record: RoutineOccurrenceHistoryRecord | null = null;
		for await (const event of this.store.readStream({ streamName, fromRevision: 0n, maxCount: 2, signal: AbortSignal.timeout(10_000) }))
		{
			if (record !== null || event.streamName !== streamName || event.revision !== 0n || Buffer.byteLength(JSON.stringify(event.data), "utf8") > _MAX_RECEIPT_BYTES)
			{
				throw new Error("Routine instruction receipt has invalid immutable coordinates");
			}
			record = _RoutineOccurrenceHistoryRecordSchema.parse(event.data.record);
			const expected = _RoutineInstructionReceiptEvent(record);
			if (record.siloId !== siloId || record.conversationId !== conversationId || !isDeepStrictEqual({ id: event.id, type: event.type, data: event.data, metadata: event.metadata }, expected))
			{
				throw new Error("Routine instruction receipt does not match its occurrence");
			}
		}
		const head = await this.store.readHead(streamName);
		if (head.streamName !== streamName || head.revision !== (record === null ? null : 0n))
		{
			throw new Error("Routine instruction receipt changed during recovery");
		}
		if (record !== null)
		{
			await this._verifyHistory(record);
		}
		return record;
	}

	/** Rejects a retry that tries to replace any original instruction or ownership coordinate. */
	private async _recover(record: RoutineOccurrenceHistoryRecord): Promise<boolean>
	{
		const existing = await this.readRecord(record.siloId, record.conversationId);
		if (existing === null)
		{
			return false;
		}
		if (!isDeepStrictEqual(existing, record))
		{
			throw new Error("Routine occurrence preparation differs from its saved instruction");
		}
		return true;
	}

	/** Requires the attested message and computer to belong to the same immutable occurrence. */
	private async _verifyHistory(record: RoutineOccurrenceHistoryRecord): Promise<void>
	{
		const history = await this.reader.read({ siloId: record.siloId, conversationId: record.conversationId, fromRevision: 1n, maxCount: 1, maximumBytes: _MAX_RECEIPT_BYTES, signal: AbortSignal.timeout(10_000) });
		if (!isDeepStrictEqual(history.genesis, _RoutineGenesis(record)) || !isDeepStrictEqual(history.entries[0], _RoutineInstructionEntry(record)))
		{
			throw new Error("Routine instruction receipt has no matching conversation history");
		}
		const computer = await this.computers.load({ computer: { siloId: record.siloId, conversationId: record.conversationId, computerId: record.computerId, agentIdentityId: record.agentIdentityId }, profileRevisionId: record.profileRevisionId });
		if (computer === null || computer.computer.createdAt !== record.createdAt)
		{
			throw new Error("Routine instruction receipt has no matching computer history");
		}
	}
}

/** Rejects an oversized audience record before its first history write. */
function _RequireBoundedRecord(record: RoutineOccurrenceHistoryRecord): void
{
	if (Buffer.byteLength(JSON.stringify({ record }), "utf8") > _MAX_RECEIPT_BYTES)
	{
		throw new Error("Routine instruction receipt exceeds its metadata size limit");
	}
}

/** Returns a stable, content-free receipt rather than a new allocation on every retry. */
function _PreparationReceipt(record: RoutineOccurrenceHistoryRecord): RoutineOccurrencePreparationReceipt
{
	return { receiptId: _RoutineEventId("receipt", record.conversationId), historyReference: _RoutineInstructionStream(record.conversationId), digest: _RoutineHistoryDigest(record) };
}
