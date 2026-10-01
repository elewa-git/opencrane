import { createHash } from "node:crypto";

import type { HistoryStore } from "@opencrane/backend/server/infra/history-store";

import type { ConversationComputerActivity, ConversationComputerActivityReader } from "./conversation-computer-activity.types";
import type { ConversationComputerLeaseCoordinates } from "@opencrane/backend/server/conversations/computers";

/** Event appended when a turn is bootstrapped on the lease. */
const _ACTIVE_EVENT = "opencrane.conversation-computer-turn-active.v1";
/** Event appended when that turn has produced output and released its credential. */
const _SETTLED_EVENT = "opencrane.conversation-computer-turn-settled.v1";

/**
 * Derives the deterministic active-turn stream for one lease.
 *
 * The turn store appends a turn-active event on bootstrap and a turn-settled event after output,
 * so the head of this stream is the newest durable activity of the lease. The derivation must stay
 * identical to the turn store's stream selection.
 * @param command - Names the exact lease whose stream is derived.
 */
export function _ConversationComputerActiveTurnStreamName(command: ConversationComputerLeaseCoordinates): string
{
	return `conversation-computer-active-turn-${createHash("sha256").update(JSON.stringify([command.siloId, command.computerId, command.lease.leaseGeneration, command.lease.leaseId])).digest("hex")}`;
}

/** Reads lease activity from the head of the deterministic active-turn stream. */
export class KurrentConversationComputerActivityReader implements ConversationComputerActivityReader
{
	/** Connects the reader to the narrow read-only KurrentDB port. */
	public constructor(private readonly history: Pick<HistoryStore, "readHead" | "readStream">) {}

	/** Return the recorded time and busy state of the newest turn event, or null without turns. */
	public async lastActivity(command: ConversationComputerLeaseCoordinates): Promise<ConversationComputerActivity | null>
	{
		const streamName = _ConversationComputerActiveTurnStreamName(command);
		const head = await this.history.readHead(streamName);
		if (head.streamName !== streamName)
			throw new Error("Conversation computer activity read returned a foreign stream head");
		if (head.revision === null)
			return null;
		let newest: ConversationComputerActivity | null = null;
		for await (const event of this.history.readStream({ streamName, fromRevision: head.revision }))
		{
			if (event.type !== _ACTIVE_EVENT && event.type !== _SETTLED_EVENT)
				throw new Error("Conversation computer activity history holds an unsupported event");
			if (event.data["leaseId"] !== undefined && event.data["leaseId"] !== command.lease.leaseId)
				throw new Error("Conversation computer activity history crossed its lease fence");
			newest = { lastActivityAt: event.recordedAt, busy: event.type === _ACTIVE_EVENT };
		}
		if (newest === null)
			throw new Error("Conversation computer activity history omitted its head event");
		return newest;
	}
}
