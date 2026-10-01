import type { HistoryRecordedEvent, HistoryStore } from "@opencrane/backend/server/infra/history-store";

import { _ConversationComputerActiveTurnStreamName } from "../lifecycle/conversation-computer-activity";
import { KurrentConversationComputerTurnStore } from "../turns/conversation-computer-turn-store";
import type { ConversationComputerStopActiveTurnReader } from "./conversation-computer-stop.types";

const _ACTIVE_EVENT = "opencrane.conversation-computer-turn-active.v1";
const _SETTLED_EVENT = "opencrane.conversation-computer-turn-settled.v1";

/** Resolves only the active turn named by an already-authoritative relational lease. */
export class KurrentConversationComputerStopActiveTurnReader implements ConversationComputerStopActiveTurnReader
{
	private readonly turns: KurrentConversationComputerTurnStore;

	/** Connects the exact-lease reader to immutable active-turn and turn streams. */
	public constructor(private readonly history: Pick<HistoryStore, "append" | "appendAtomic" | "readHead" | "readStream">)
	{
		this.turns = new KurrentConversationComputerTurnStore(history);
	}

	/** Read the checked pointer head once and load only the bootstrap named by that event. */
	public async read(command: { readonly siloId: string; readonly computerId: string; readonly leaseId: string; readonly leaseGeneration: number })
	{
		const activeTurnStreamName = _ConversationComputerActiveTurnStreamName({ siloId: command.siloId, computerId: command.computerId, lease: { leaseId: command.leaseId, leaseGeneration: command.leaseGeneration } });
		const head = await this.history.readHead(activeTurnStreamName);
		if (head.streamName !== activeTurnStreamName)
			throw new Error("Conversation Stop active-turn read returned a foreign stream");
		if (head.revision === null)
			return { turn: null, activeTurnStreamName, activeTurnExpectedRevision: null };
		const event = await _HeadEvent(this.history, activeTurnStreamName, head.revision);
		_AssertLease(event, command);
		if (event.type === _SETTLED_EVENT)
			return { turn: null, activeTurnStreamName, activeTurnExpectedRevision: head.revision.toString() };
		if (event.type !== _ACTIVE_EVENT)
			throw new Error("Conversation Stop active-turn head has an unsupported event");
		const bootstrapId = event.data["bootstrapId"];
		if (typeof bootstrapId !== "string")
			throw new Error("Conversation Stop active-turn head omitted its bootstrap identifier");
		const turn = await this.turns.load(bootstrapId);
		if (turn === null || turn.siloId !== command.siloId || turn.computerId !== command.computerId || turn.lease.leaseId !== command.leaseId || turn.lease.leaseGeneration !== command.leaseGeneration)
			throw new Error("Conversation Stop active-turn pointer differs from its frozen turn");
		return { turn, activeTurnStreamName, activeTurnExpectedRevision: head.revision.toString() };
	}
}

async function _HeadEvent(history: Pick<HistoryStore, "readStream">, streamName: string, revision: bigint): Promise<HistoryRecordedEvent>
{
	for await (const event of history.readStream({ streamName, fromRevision: revision, maxCount: 1 }))
	{
		if (event.revision !== revision)
			break;
		return event;
	}
	throw new Error("Conversation Stop active-turn stream omitted its checked head");
}

function _AssertLease(event: HistoryRecordedEvent, command: { readonly siloId: string; readonly computerId: string; readonly leaseId: string; readonly leaseGeneration: number }): void
{
	const coordinates = { ...event.metadata, ...event.data };
	if (coordinates["siloId"] !== command.siloId || coordinates["computerId"] !== command.computerId || coordinates["leaseId"] !== command.leaseId || coordinates["generation"] !== command.leaseGeneration)
		throw new Error("Conversation Stop active-turn history crossed its lease fence");
}
