import { z } from "zod";
import type { HistoryRecordedEvent } from "@opencrane/backend/server/infra/history-store";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import { _ConversationComputerEventId } from "../conversation-computer-event-id";
import type { ConversationComputerTurnToolSelection } from "./conversation-computer-turn-protocol.types";
import type { FrozenConversationComputerTurn } from "./conversation-computer-turn.types";

/** Identifies the fresh-install ordered tool-selection event. */
export const _CONVERSATION_TOOL_SELECTED_EVENT = "opencrane.conversation-computer-turn-tool-selected.v2";

const _Digest = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const _Identifier = z.string().min(1);
const _SelectionSchema: z.ZodType<ConversationComputerTurnToolSelection> = z.object({
	ordinal: z.number().int().positive().safe(),
	modelInvocationFence: z.string().uuid(),
	declaration: z.object({ payloadRef: _Identifier, ciphertextDigest: _Digest }).strict(),
	proposalId: _Identifier,
	toolInvocationId: _Identifier,
	requestFingerprint: _Digest,
}).strict();

/** Builds a content-free per-step selection after encrypted declaration custody. */
export function _ConversationToolSelectionEvent(turn: FrozenConversationComputerTurn, selection: ConversationComputerTurnToolSelection)
{
	return {
		id: _ConversationComputerEventId(`tool-selection-${selection.ordinal}`, selection.proposalId),
		type: _CONVERSATION_TOOL_SELECTED_EVENT,
		data: { bootstrapId: turn.bootstrapId, selection },
		metadata: _Metadata(turn),
	};
}

/**
 * Verifies one exact selection event without admitting or dispatching its tool.
 *
 * Called by: KurrentConversationComputerTurnStore during replay and before append.
 *
 * @param event Recorded event or locally prepared candidate at its proposed revision.
 * @param turn Frozen turn and projection immediately before this event.
 * @returns The validated selection.
 * @throws Error when the event identity, stream, revision, metadata or selection differs.
 */
export function _ReadConversationToolSelection(event: HistoryRecordedEvent, turn: FrozenConversationComputerTurn): ConversationComputerTurnToolSelection
{
	const selection = _SelectionSchema.parse(event.data["selection"]);
	const expected = _ConversationToolSelectionEvent(turn, selection);
	if (event.revision !== turn.protocol.revision + 1n || event.streamName !== _Stream(turn.bootstrapId) || event.type !== expected.type || event.id !== expected.id
		|| ___DigestCanonicalJson(event.data as JsonValue) !== ___DigestCanonicalJson(expected.data as unknown as JsonValue)
		|| ___DigestCanonicalJson(event.metadata as JsonValue) !== ___DigestCanonicalJson(expected.metadata as unknown as JsonValue))
		throw new Error("Conversation computer tool selection crossed its exact event fence");
	return selection;
}

function _Metadata(turn: FrozenConversationComputerTurn): Record<string, unknown>
{
	return { siloId: turn.siloId, computerId: turn.computerId, leaseId: turn.lease.leaseId, generation: String(turn.lease.leaseGeneration), bootstrapId: turn.bootstrapId };
}

function _Stream(bootstrapId: string): string
{
	return `conversation-computer-turn-${bootstrapId}`;
}
