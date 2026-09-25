import { ConversationA2UIOperations, ConversationEntryAudiences, ConversationEntryKinds, MessageStates } from "@opencrane/contracts";
import { _ReadBoundConversationWriterIntent, type BoundConversationWriterIntent } from "@opencrane/backend/server/conversations/history";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import { _ConversationComputerEventId } from "../../conversation-computer-event-id";
import type { ConversationComputerTurnOutputReceipt } from "../conversation-computer-turn-protocol.types";
import type { FrozenConversationComputerTurn } from "../conversation-computer-turn.types";

/** Derives the companion entry and display identity from the server's winning model reservation. */
export function _ConversationStructuredOutputId(sourceCommandId: string): string
{
	return _ConversationComputerEventId("structured-output", sourceCommandId);
}

/** Returns the primary answer followed by its optional display, without changing either event. */
export function _ConversationComputerOutputIntents(receipt: ConversationComputerTurnOutputReceipt): readonly BoundConversationWriterIntent[]
{
	const { display, ...answer } = receipt;
	return display === null ? [answer] : [answer, display];
}

/**
 * Checks the complete output against its admitted turn before writing or replaying its receipt.
 * The primary Message preserves answer and file identity; a display can only occupy the next
 * position with a server-derived identity and the same participant audience and request origin.
 * @throws Error if either event or the complete output shape differs from that admission.
 */
export function _ReadConversationComputerOutputReceipt(turn: FrozenConversationComputerTurn, value: unknown, sourceCommandId: string): ConversationComputerTurnOutputReceipt
{
	if (value === null || typeof value !== "object" || Array.isArray(value) || !("display" in value))
		throw new Error("Conversation computer output requires its complete receipt");
	const { display, ...candidate } = value as Record<string, unknown>;
	const expectedRevision = candidate["expectedRevision"];
	if (typeof expectedRevision !== "string" || !/^(0|[1-9][0-9]*)$/u.test(expectedRevision) || BigInt(expectedRevision) < turn.binding.expectedRevision)
		throw new Error("Conversation computer output decision has an invalid history position");
	const intent = _ReadBoundConversationWriterIntent({ ...turn.binding, expectedRevision: BigInt(expectedRevision) }, candidate);
	const entry = intent.event.data.entry;
	if (intent.event.id !== sourceCommandId || entry.kind !== ConversationEntryKinds.Message || entry.state !== MessageStates.Completed
		|| entry.replyToEntryId !== turn.latestPendingEntryId || entry.addressedAgentIdentityId !== null || entry.activation !== "none"
		|| entry.visibility.audience !== ConversationEntryAudiences.Conversation || entry.causationId !== turn.latestPendingEntryId || entry.correlationId !== turn.latestPendingEntryId)
		throw new Error("Conversation computer output decision has a different answer shape");
	if (display === null)
		return { ...intent, display: null };
	const companion = _ReadBoundConversationWriterIntent({ ...turn.binding, expectedRevision: BigInt(expectedRevision) + 1n }, display);
	const displayEntry = companion.event.data.entry;
	const displayId = _ConversationStructuredOutputId(sourceCommandId);
	if (companion.event.id !== displayId || displayEntry.kind !== ConversationEntryKinds.A2UI
		|| displayEntry.surfaceId !== displayId || displayEntry.a2uiSchemaVersion !== "0.8" || displayEntry.operation !== ConversationA2UIOperations.Replace
		|| displayEntry.visibility.audience !== ConversationEntryAudiences.Conversation
		|| displayEntry.causationId !== turn.latestPendingEntryId || displayEntry.correlationId !== turn.latestPendingEntryId)
		throw new Error("Conversation computer output decision has a different display shape");
	return { ...intent, display: companion };
}

/** Compares every output field except new preparation timestamps; committed confirmation remains exact. */
export function _SameConversationComputerOutputReceipt(left: ConversationComputerTurnOutputReceipt, right: ConversationComputerTurnOutputReceipt): boolean
{
	return _outputDigest(left) === _outputDigest(right);
}

/** Keeps both entries in retry equality, including the explicit absence of a display. */
function _outputDigest(receipt: ConversationComputerTurnOutputReceipt): string
{
	const entries = _ConversationComputerOutputIntents(receipt).map(intent => ({ ...intent, event: { ...intent.event, data: { entry: { ...intent.event.data.entry, occurredAt: null } } } }));
	return ___DigestCanonicalJson(entries as unknown as JsonValue);
}
