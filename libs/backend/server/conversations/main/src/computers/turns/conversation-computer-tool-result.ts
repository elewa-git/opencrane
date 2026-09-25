import { z } from "zod";
import type { HistoryRecordedEvent } from "@opencrane/backend/server/infra/history-store";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import { _ConversationComputerEventId } from "../conversation-computer-event-id";
import type { ConversationComputerTurnToolResult } from "./conversation-computer-turn-protocol.types";
import type { FrozenConversationComputerTurn } from "./conversation-computer-turn.types";

/** Identifies the event that records one privately saved assistant/tool exchange. */
export const _CONVERSATION_TOOL_RESULT_RECORDED_EVENT = "opencrane.conversation-computer-turn-tool-result-recorded.v1";

const _Digest = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const _Identifier = z.string().min(1);
const _ResultSchema: z.ZodType<ConversationComputerTurnToolResult> = z.object({
	ordinal: z.number().int().positive().safe(),
	proposalId: _Identifier,
	toolInvocationId: _Identifier,
	resultDigest: _Digest,
	exchange: z.object({ payloadRef: _Identifier, ciphertextDigest: _Digest }).strict(),
	authorityExpiresAtEpochMs: z.number().int().positive().safe(),
}).strict();

/** Builds non-secret result evidence after the exact assistant/tool exchange enters custody. */
export function _ConversationToolResultEvent(turn: FrozenConversationComputerTurn, result: ConversationComputerTurnToolResult)
{
	return {
		id: _ConversationComputerEventId(`tool-result-${result.ordinal}`, result.toolInvocationId),
		type: _CONVERSATION_TOOL_RESULT_RECORDED_EVENT,
		data: { bootstrapId: turn.bootstrapId, result },
		metadata: _Metadata(turn),
	};
}

/** Validates one result event without reading, consuming or disclosing its private payload. */
export function _ReadConversationToolResult(event: HistoryRecordedEvent, turn: FrozenConversationComputerTurn): ConversationComputerTurnToolResult
{
	const result = _ResultSchema.parse(event.data["result"]);
	const expected = _ConversationToolResultEvent(turn, result);
	if (event.revision !== turn.protocol.revision + 1n || event.streamName !== _Stream(turn.bootstrapId) || event.type !== expected.type || event.id !== expected.id
		|| ___DigestCanonicalJson(event.data as JsonValue) !== ___DigestCanonicalJson(expected.data as unknown as JsonValue)
		|| ___DigestCanonicalJson(event.metadata as JsonValue) !== ___DigestCanonicalJson(expected.metadata as unknown as JsonValue))
		throw new Error("Conversation computer tool result crossed its exact event fence");
	return result;
}

function _Metadata(turn: FrozenConversationComputerTurn): Record<string, unknown>
{
	return { siloId: turn.siloId, computerId: turn.computerId, leaseId: turn.lease.leaseId, generation: String(turn.lease.leaseGeneration), bootstrapId: turn.bootstrapId };
}

function _Stream(bootstrapId: string): string
{
	return `conversation-computer-turn-${bootstrapId}`;
}
