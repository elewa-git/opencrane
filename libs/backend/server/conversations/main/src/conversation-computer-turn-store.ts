import { createHash } from "node:crypto";
import { WrongExpectedVersionError } from "@kurrent/kurrentdb-client";
import { HistoryExpectedRevisions, type HistoryRecordedEvent, type HistoryStore } from "@opencrane/backend/server/infra/history-store";

import type { ConversationComputerTurnOutputReceipt, ConversationComputerTurnStore, FrozenConversationComputerTurn } from "./conversation-computer-turn.types";

const _FROZEN_EVENT = "opencrane.conversation-computer-turn-frozen.v1";
const _OUTPUT_EVENT = "opencrane.conversation-computer-turn-output.v1";
const _ACTIVE_EVENT = "opencrane.conversation-computer-turn-active.v1";
const _SETTLED_EVENT = "opencrane.conversation-computer-turn-settled.v1";

/** Persists immutable turn input and terminal output coordinates in a deterministic Kurrent stream. */
export class KurrentConversationComputerTurnStore implements ConversationComputerTurnStore
{
	public constructor(private readonly history: Pick<HistoryStore, "append" | "readStream">) {}

	/** Create the deterministic turn stream or return the byte-equivalent frozen turn. */
	public async createOrRead(turn: FrozenConversationComputerTurn): Promise<FrozenConversationComputerTurn>
	{
		let result = turn;
		try
		{
			await this.history.append({ streamName: _Stream(turn.bootstrapId), expectedRevision: HistoryExpectedRevisions.NoStream, events: [{ id: turn.bootstrapId, type: _FROZEN_EVENT, data: { turn: _Serializable(turn) }, metadata: _Metadata(turn) }] });
		}
		catch (error)
		{
			if (!(error instanceof WrongExpectedVersionError))
				throw error;
			const existing = await this.load(turn.bootstrapId);
			if (existing === null)
				throw new Error("Conversation computer turn conflict omitted its frozen event");
			result = existing;
		}
		await this._Activate(result);
		return result;
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
				const receipt = _Output(event, bootstrapId);
				frozen = { ...current, outputSourceCommandId: receipt.sourceCommandId, outputReceipt: receipt };
			}
			else throw new Error("Conversation computer turn history is noncontiguous");
		}
		return frozen;
	}

	/** Append exactly one output coordinate or recognize the same uncertain retry. */
	public async loadActive(command: { readonly siloId: string; readonly computerId: string; readonly generation: number; readonly leaseId: string }): Promise<FrozenConversationComputerTurn | null>
	{
		let active: string | null = null;
		for await (const event of this.history.readStream({ streamName: _ActiveStream(command) }))
		{
			if (event.type === _ACTIVE_EVENT)
				active = _ActiveBootstrap(event, command);
			else if (event.type === _SETTLED_EVENT && event.data["bootstrapId"] === active)
				active = null;
			else throw new Error("Conversation computer active-turn history is invalid");
		}
		return active === null ? null : await this.load(active);
	}

	/** Append a restart-safe output receipt after the encrypted payload is durable. */
	public async markOutput(bootstrapId: string, receipt: ConversationComputerTurnOutputReceipt): Promise<"accepted" | "idempotent">
	{
		try
		{
			await this.history.append({ streamName: _Stream(bootstrapId), expectedRevision: 0n, events: [{ id: receipt.sourceCommandId, type: _OUTPUT_EVENT, data: { bootstrapId, ...receipt }, metadata: { bootstrapId } }] });
			return "accepted";
		}
		catch (error)
		{
			if (!(error instanceof WrongExpectedVersionError))
				throw error;
			const existing = await this.load(bootstrapId);
			if (existing?.outputReceipt !== null && existing !== null && _SameReceipt(existing.outputReceipt, receipt))
				return "idempotent";
			throw new Error("Conversation computer turn already records a different output");
		}
	}

	/** Release the active-turn pointer only after run completion and credential revocation converge. */
	public async settle(turn: FrozenConversationComputerTurn): Promise<void>
	{
		const events = await _Events(this.history, _ActiveStream(turn));
		if (events.at(-1)?.type === _SETTLED_EVENT)
			return;
		try
		{
			await this.history.append({ streamName: _ActiveStream(turn), expectedRevision: BigInt(events.length - 1), events: [{ id: _Uuid("settled", turn.bootstrapId), type: _SETTLED_EVENT, data: { bootstrapId: turn.bootstrapId }, metadata: _Metadata(turn) }] });
		}
		catch (error)
		{
			if (!(error instanceof WrongExpectedVersionError) || await this.loadActive(turn) !== null)
				throw error;
		}
	}

	private async _Activate(turn: FrozenConversationComputerTurn): Promise<void>
	{
		const streamName = _ActiveStream(turn);
		const events = await _Events(this.history, streamName);
		const last = events.at(-1);
		if (last?.type === _ACTIVE_EVENT && last.data["bootstrapId"] === turn.bootstrapId)
			return;
		if (last?.type === _ACTIVE_EVENT)
			throw new Error("Conversation computer already has an unsettled turn");
		try
		{
			await this.history.append({ streamName, expectedRevision: events.length === 0 ? HistoryExpectedRevisions.NoStream : BigInt(events.length - 1), events: [{ id: turn.bootstrapId, type: _ACTIVE_EVENT, data: { bootstrapId: turn.bootstrapId, siloId: turn.siloId, computerId: turn.computerId, generation: turn.generation, leaseId: turn.leaseId }, metadata: _Metadata(turn) }] });
		}
		catch (error)
		{
			const active = error instanceof WrongExpectedVersionError ? await this.loadActive(turn) : null;
			if (active?.bootstrapId !== turn.bootstrapId)
				throw error;
		}
	}
}

async function _Events(history: Pick<HistoryStore, "readStream">, streamName: string): Promise<HistoryRecordedEvent[]>
{
	const events: HistoryRecordedEvent[] = [];
	for await (const event of history.readStream({ streamName }))
		events.push(event);
	return events;
}

function _ActiveStream(command: { readonly siloId: string; readonly computerId: string; readonly generation: number; readonly leaseId: string }): string
{
	return `conversation-computer-active-turn-${createHash("sha256").update(JSON.stringify([command.siloId, command.computerId, command.generation, command.leaseId])).digest("hex")}`;
}

function _ActiveBootstrap(event: HistoryRecordedEvent, command: { readonly siloId: string; readonly computerId: string; readonly generation: number; readonly leaseId: string }): string
{
	const bootstrapId = event.data["bootstrapId"];
	if (typeof bootstrapId !== "string" || event.data["siloId"] !== command.siloId || event.data["computerId"] !== command.computerId || event.data["generation"] !== command.generation || event.data["leaseId"] !== command.leaseId)
		throw new Error("Conversation computer active-turn history crossed its lease fence");
	return bootstrapId;
}

function _Uuid(domain: string, value: string): string
{
	const hex = createHash("sha256").update(`${domain}:${value}`).digest("hex").slice(0, 32).split("");
	hex[12] = "4";
	hex[16] = "8";
	return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}

function _SameReceipt(left: ConversationComputerTurnOutputReceipt, right: ConversationComputerTurnOutputReceipt): boolean
{
	return left.sourceCommandId === right.sourceCommandId && left.blockId === right.blockId && left.payloadRef === right.payloadRef && left.ciphertextDigest === right.ciphertextDigest;
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
	return { ...value, binding: { ...value.binding, expectedRevision: BigInt(value.binding.expectedRevision) }, outputSourceCommandId: null, outputReceipt: null };
}

function _Output(event: HistoryRecordedEvent, bootstrapId: string): ConversationComputerTurnOutputReceipt
{
	const sourceCommandId = event.data["sourceCommandId"];
	const blockId = event.data["blockId"];
	const payloadRef = event.data["payloadRef"];
	const ciphertextDigest = event.data["ciphertextDigest"];
	if (event.type !== _OUTPUT_EVENT || event.data["bootstrapId"] !== bootstrapId || typeof sourceCommandId !== "string" || typeof blockId !== "string" || typeof payloadRef !== "string" || typeof ciphertextDigest !== "string" || event.id !== sourceCommandId)
		throw new Error("Conversation computer turn received an invalid output event");
	return { sourceCommandId, blockId, payloadRef, ciphertextDigest };
}
