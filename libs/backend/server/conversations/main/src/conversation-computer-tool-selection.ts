import { createHash } from "node:crypto";
import { ConversationModelToolModes } from "@opencrane/contracts";
import type { HistoryRecordedEvent } from "@opencrane/backend/server/infra/history-store";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import type { ConversationComputerToolSelection } from "./conversation-computer-continuation.types";
import { _ConversationToolSelectionSchema } from "./conversation-computer-continuation.validator";
import type { FrozenConversationComputerTurn } from "./conversation-computer-turn.types";

/** Identifies the saved model declaration that owns the turn's single tool slot. */
export const _CONVERSATION_TOOL_SELECTED_EVENT = "opencrane.conversation-computer-turn-tool-selected.v1";

/** Builds a private, content-free selection event after encrypted declaration custody. */
export function _ConversationToolSelectionEvent(turn: FrozenConversationComputerTurn, selection: ConversationComputerToolSelection)
{
	const reservation = turn.modelReservation;
	if (reservation === null || reservation.tools !== ConversationModelToolModes.Select)
		throw new Error("Conversation computer did not reserve tool selection");
	const hex = createHash("sha256").update(`tool-selection:${reservation.invocationFence}`).digest("hex");
	const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
	return { id, type: _CONVERSATION_TOOL_SELECTED_EVENT, data: { bootstrapId: turn.bootstrapId, modelInvocationFence: reservation.invocationFence, selection }, metadata: { bootstrapId: turn.bootstrapId } };
}

/** Verifies the exact decision, including full readback after a same-ID append acknowledgement. */
export function _ReadConversationToolSelection(event: HistoryRecordedEvent, turn: FrozenConversationComputerTurn): ConversationComputerToolSelection
{
	const selection = _ConversationToolSelectionSchema.parse(event.data["selection"]);
	const expected = _ConversationToolSelectionEvent(turn, selection);
	if (event.revision !== 2n || event.streamName !== `conversation-computer-turn-${turn.bootstrapId}` || event.type !== expected.type || event.id !== expected.id
		|| ___DigestCanonicalJson(event.data as JsonValue) !== ___DigestCanonicalJson(expected.data as unknown as JsonValue)
		|| ___DigestCanonicalJson(event.metadata as JsonValue) !== ___DigestCanonicalJson(expected.metadata))
		throw new Error("Conversation computer tool selection crossed its exact event fence");
	return selection;
}
