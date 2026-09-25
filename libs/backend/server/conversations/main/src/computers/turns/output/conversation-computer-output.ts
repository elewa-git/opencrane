import { ConversationA2UIOperations, ConversationEntryAudiences, ConversationEntryKinds, ConversationMessageContentBlockKinds, MessageStates } from "@opencrane/contracts";
import type { RuntimeWorkloadIdentity } from "@opencrane/backend/server/infra/workload-identity";

import { _ConversationComputerAnswerBlocks } from "../generated-output/conversation-generated-file-output";
import type { ConversationGeneratedFileContinuation } from "../../tools/results/conversation-generated-file-result.types";
import type { ConversationComputerBoundWriterFactory, FrozenConversationComputerTurn } from "../conversation-computer-turn.types";
import type { ConversationComputerTurnOutputReceipt } from "../conversation-computer-turn-protocol.types";
import { _ConversationStructuredOutputId } from "./conversation-computer-output-receipt";
import type { ConversationComputerOutputPayload } from "./conversation-computer-output.types";

/**
 * Prepares adjacent entries using the existing server-stamping writer; this function never appends.
 * The caller must recheck current answer authority and commit the whole receipt atomically.
 */
export async function _PrepareConversationComputerOutput(turn: FrozenConversationComputerTurn, workload: RuntimeWorkloadIdentity, writers: ConversationComputerBoundWriterFactory, sourceCommandId: string, payload: ConversationComputerOutputPayload, generatedFile?: ConversationGeneratedFileContinuation): Promise<ConversationComputerTurnOutputReceipt>
{
	const writer = writers.create(turn, workload);
	const origin = { visibility: { audience: ConversationEntryAudiences.Conversation }, causationId: turn.latestPendingEntryId, correlationId: turn.latestPendingEntryId } as const;
	const answer = await writer.prepare({ sourceCommandId, entry: { ...origin, kind: ConversationEntryKinds.Message, state: MessageStates.Completed, blocks: _ConversationComputerAnswerBlocks({ id: payload.blockId, kind: ConversationMessageContentBlockKinds.Text, payloadRef: payload.payloadRef, ciphertextDigest: payload.ciphertextDigest }, generatedFile), replyToEntryId: turn.latestPendingEntryId, addressedAgentIdentityId: null, activation: "none" } });
	if (payload.display === null)
		return { ...answer, display: null };
	const companionTurn = { ...turn, binding: { ...turn.binding, expectedRevision: turn.binding.expectedRevision + 1n } };
	const companionWriter = writers.create(companionTurn, workload);
	const surfaceId = _ConversationStructuredOutputId(sourceCommandId);
	const display = await companionWriter.prepare({ sourceCommandId: surfaceId, entry: { ...origin, kind: ConversationEntryKinds.A2UI, operation: ConversationA2UIOperations.Replace, surfaceId, a2uiSchemaVersion: "0.8", payloadRef: payload.display.payloadRef, payloadDigest: payload.display.ciphertextDigest } });
	return { ...answer, display };
}

/** Rejects a retry whose encrypted content or presence of a display differs from the saved output. */
export function _AssertConversationComputerOutputPayload(receipt: ConversationComputerTurnOutputReceipt, payload: ConversationComputerOutputPayload): void
{
	const entry = receipt.event.data.entry;
	if (entry.kind !== ConversationEntryKinds.Message || entry.blocks[0]?.kind !== ConversationMessageContentBlockKinds.Text
		|| entry.blocks[0].id !== payload.blockId || entry.blocks[0].payloadRef !== payload.payloadRef || entry.blocks[0].ciphertextDigest !== payload.ciphertextDigest)
		throw new Error("Conversation computer output retry has a different saved payload");
	const display = receipt.display?.event.data.entry ?? null;
	if (payload.display === null && display === null)
		return;
	if (payload.display === null || display?.kind !== ConversationEntryKinds.A2UI
		|| display.payloadRef !== payload.display.payloadRef || display.payloadDigest !== payload.display.ciphertextDigest)
		throw new Error("Conversation computer output retry has a different saved display");
}
