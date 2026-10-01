import { z } from "zod";
import type { HistoryRecordedEvent } from "@opencrane/backend/server/infra/history-store";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import { _ConversationComputerEventId } from "../conversation-computer-event-id";
import { ConversationComputerTurnUnavailableReasons } from "./conversation-computer-turn-protocol.types";
import type { ConversationComputerTurnUnavailableReceipt } from "./conversation-computer-turn-protocol.types";
import type { FrozenConversationComputerTurn } from "./conversation-computer-turn.types";

/** Identifies the durable bounded response-unavailable event. */
export const _CONVERSATION_TURN_RESPONSE_UNAVAILABLE_EVENT = "opencrane.conversation-computer-turn-response-unavailable.v1";

const _ReceiptSchema: z.ZodType<ConversationComputerTurnUnavailableReceipt> = z.object({
	ordinal: z.number().int().positive().safe().nullable(),
	sourceCommandId: z.string().min(1),
	reason: z.nativeEnum(ConversationComputerTurnUnavailableReasons),
}).strict();

/** Builds a safe terminal diagnostic without provider or private result content. */
export function _ConversationTurnUnavailableEvent(turn: FrozenConversationComputerTurn, receipt: ConversationComputerTurnUnavailableReceipt)
{
	return {
		id: _ConversationComputerEventId("response-unavailable", receipt.sourceCommandId),
		type: _CONVERSATION_TURN_RESPONSE_UNAVAILABLE_EVENT,
		data: { bootstrapId: turn.bootstrapId, receipt },
		metadata: _Metadata(turn),
	};
}

/** Validates one unavailable event against the immediately preceding protocol projection. */
export function _ReadConversationTurnUnavailable(event: HistoryRecordedEvent, turn: FrozenConversationComputerTurn): ConversationComputerTurnUnavailableReceipt
{
	const receipt = _ReceiptSchema.parse(event.data["receipt"]);
	const expected = _ConversationTurnUnavailableEvent(turn, receipt);
	if (event.revision !== turn.protocol.revision + 1n || event.streamName !== _Stream(turn.bootstrapId) || event.type !== expected.type || event.id !== expected.id
		|| ___DigestCanonicalJson(event.data as JsonValue) !== ___DigestCanonicalJson(expected.data as unknown as JsonValue)
		|| ___DigestCanonicalJson(event.metadata as JsonValue) !== ___DigestCanonicalJson(expected.metadata as unknown as JsonValue))
		throw new Error("Conversation computer unavailable event crossed its exact event fence");
	return receipt;
}

function _Metadata(turn: FrozenConversationComputerTurn): Record<string, unknown>
{
	return { siloId: turn.siloId, computerId: turn.computerId, leaseId: turn.lease.leaseId, generation: String(turn.lease.leaseGeneration), bootstrapId: turn.bootstrapId };
}

function _Stream(bootstrapId: string): string
{
	return `conversation-computer-turn-${bootstrapId}`;
}
