import { WrongExpectedVersionError } from "@kurrent/kurrentdb-client";
import { HistoryExpectedRevisions, type HistoryRecordedEvent, type HistoryStore } from "@opencrane/backend/server/infra/history-store";

import type { ConversationComputerTurnStore, FrozenConversationComputerTurn } from "./conversation-computer-turn.types";

const _FROZEN_EVENT = "opencrane.conversation-computer-turn-frozen.v1";
const _OUTPUT_EVENT = "opencrane.conversation-computer-turn-output.v1";

/** Persists immutable turn input and terminal output coordinates in a deterministic Kurrent stream. */
export class KurrentConversationComputerTurnStore implements ConversationComputerTurnStore
{
	public constructor(private readonly history: Pick<HistoryStore, "append" | "readStream">) {}

	/** Create the deterministic turn stream or return the byte-equivalent frozen turn. */
	public async createOrRead(turn: FrozenConversationComputerTurn): Promise<FrozenConversationComputerTurn>
	{
		try
		{
			await this.history.append({ streamName: _Stream(turn.bootstrapId), expectedRevision: HistoryExpectedRevisions.NoStream, events: [{ id: turn.bootstrapId, type: _FROZEN_EVENT, data: { turn: _Serializable(turn) }, metadata: _Metadata(turn) }] });
			return turn;
		}
		catch (error)
		{
			if (!(error instanceof WrongExpectedVersionError))
				throw error;
			const existing = await this.load(turn.bootstrapId);
			if (existing === null)
				throw new Error("Conversation computer turn conflict omitted its frozen event");
			return existing;
		}
	}

	/** Load and validate the frozen record plus its optional terminal output coordinate. */
	public async load(bootstrapId: string): Promise<FrozenConversationComputerTurn | null>
	{
		let frozen: FrozenConversationComputerTurn | null = null;
		for await (const event of this.history.readStream({ streamName: _Stream(bootstrapId) }))
		{
			if (event.revision === 0n)
				frozen = _Frozen(event, bootstrapId);
			else if (event.revision === 1n && frozen !== null)
			{
				const current: FrozenConversationComputerTurn = frozen;
				frozen = { ...current, outputSourceCommandId: _Output(event, bootstrapId) };
			}
			else throw new Error("Conversation computer turn history is noncontiguous");
		}
		return frozen;
	}

	/** Append exactly one output coordinate or recognize the same uncertain retry. */
	public async markOutput(bootstrapId: string, sourceCommandId: string): Promise<"accepted" | "idempotent">
	{
		try
		{
			await this.history.append({ streamName: _Stream(bootstrapId), expectedRevision: 0n, events: [{ id: sourceCommandId, type: _OUTPUT_EVENT, data: { bootstrapId, sourceCommandId }, metadata: { bootstrapId } }] });
			return "accepted";
		}
		catch (error)
		{
			if (!(error instanceof WrongExpectedVersionError))
				throw error;
			const existing = await this.load(bootstrapId);
			if (existing?.outputSourceCommandId === sourceCommandId)
				return "idempotent";
			throw new Error("Conversation computer turn already records a different output");
		}
	}
}

function _Stream(bootstrapId: string): string
{
	if (!/^[0-9a-f-]{36}$/iu.test(bootstrapId))
		throw new Error("Conversation computer turn requires a UUID bootstrap identifier");
	return `conversation-computer-turn-${bootstrapId}`;
}

function _Serializable(turn: FrozenConversationComputerTurn): Record<string, unknown>
{
	return { ...turn, binding: { ...turn.binding, expectedRevision: turn.binding.expectedRevision.toString() } };
}

function _Metadata(turn: FrozenConversationComputerTurn): Record<string, unknown>
{
	return { siloId: turn.siloId, computerId: turn.computerId, leaseId: turn.leaseId, generation: turn.generation, bootstrapId: turn.bootstrapId };
}

function _Frozen(event: HistoryRecordedEvent, bootstrapId: string): FrozenConversationComputerTurn
{
	if (event.type !== _FROZEN_EVENT || event.id !== bootstrapId || event.streamName !== _Stream(bootstrapId))
		throw new Error("Conversation computer turn received an invalid frozen event");
	const value = event.data["turn"] as FrozenConversationComputerTurn & { readonly binding: FrozenConversationComputerTurn["binding"] & { readonly expectedRevision: string } };
	if (value?.bootstrapId !== bootstrapId || typeof value.binding?.expectedRevision !== "string")
		throw new Error("Conversation computer turn received malformed frozen data");
	return { ...value, binding: { ...value.binding, expectedRevision: BigInt(value.binding.expectedRevision) }, outputSourceCommandId: null };
}

function _Output(event: HistoryRecordedEvent, bootstrapId: string): string
{
	const sourceCommandId = event.data["sourceCommandId"];
	if (event.type !== _OUTPUT_EVENT || event.data["bootstrapId"] !== bootstrapId || typeof sourceCommandId !== "string" || event.id !== sourceCommandId)
		throw new Error("Conversation computer turn received an invalid output event");
	return sourceCommandId;
}
