import { ___ConversationCreatedSchema } from "@opencrane/contracts";
import type { HistoryRecordedEvent, HistoryStore } from "@opencrane/backend/server/infra/history-store";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import { ConversationCreationAnchorConfirmationOutcomes, type ConfirmConversationCreationAnchorCommand, type ConversationCreationAnchorConfirmation } from "./conversation-creation-anchor-verifier.types";

/** Names the only revision-zero event that can prove a durable conversation creation reservation. */
const _CONVERSATION_CREATED_EVENT_TYPE = "opencrane.conversation-created.v1";

/**
 * Reads a conversation stream after an ambiguous creation append and checks whether it holds the reserved anchor.
 *
 * The verifier receives no append capability, so it cannot turn an uncertain write into a successful recovery.
 * A later creation authority must append again only after {@link confirm} reports `absent`.
 */
export class ConversationCreationAnchorVerifier
{
	/** Reads one conversation stream without receiving history append authority. */
	public constructor(private readonly historyStore: Pick<HistoryStore, "readStream">) {}

	/**
	 * Confirms only an exact revision-zero match after a creation append became ambiguous.
	 *
	 * `confirmed` proves the reserved record already occupies revision zero; `absent` leaves the
	 * append decision to the caller. A mismatched first event cannot prove idempotency, so this
	 * method throws rather than allowing another create.
	 * @param command The server-reserved stream coordinates, event identifier, and creation payload.
	 * @returns A proof of the reservation, or `absent` when the stream has no event.
	 * @throws {Error} When the stream's first event is not the reserved creation record.
	 */
	public async confirm(command: ConfirmConversationCreationAnchorCommand): Promise<ConversationCreationAnchorConfirmation>
	{
		const streamName = _StreamName(command);
		for await (const event of this.historyStore.readStream({ streamName }))
		{
			_AssertAnchor(event, command, streamName);
			return { outcome: ConversationCreationAnchorConfirmationOutcomes.Confirmed, revision: 0n };
		}
		return { outcome: ConversationCreationAnchorConfirmationOutcomes.Absent };
	}
}

/** Derives the conversation stream that the reservation may recover. */
function _StreamName(command: ConfirmConversationCreationAnchorCommand): string
{
	if (!_Identifier(command.siloId) || !_Identifier(command.created.conversationId))
		throw new Error("Conversation creation anchor confirmation requires server-provided silo and conversation coordinates");
	if (!_Uuid(command.eventId))
		throw new Error("Conversation creation anchor confirmation requires a reserved UUID event identifier");
	return `conversation-${command.created.conversationId}`;
}

/** Checks that revision zero carries the envelope and payload the server reserved. */
function _AssertAnchor(event: HistoryRecordedEvent, command: ConfirmConversationCreationAnchorCommand, streamName: string): void
{
	if (event.streamName !== streamName || event.revision !== 0n)
		throw new Error("Conversation creation anchor confirmation received a foreign or nonzero first event");
	if (event.type !== _CONVERSATION_CREATED_EVENT_TYPE || event.id !== command.eventId || event.metadata.siloId !== command.siloId || event.metadata.conversationId !== command.created.conversationId || event.metadata.idempotencyKey !== command.eventId)
		throw new Error("Conversation creation anchor does not match its reserved envelope");
	const created = ___ConversationCreatedSchema.safeParse(event.data.created);
	if (!created.success || ___DigestCanonicalJson(created.data as unknown as JsonValue) !== ___DigestCanonicalJson(command.created as unknown as JsonValue))
		throw new Error("Conversation creation anchor does not match its reserved payload");
}

/** Checks an opaque server coordinate without rewriting it before it names the history stream. */
function _Identifier(value: string): boolean
{
	return value.trim().length > 0 && value === value.trim();
}

/** Recognizes the UUID form used for a reservation's immutable KurrentDB event id. */
function _Uuid(value: string): boolean
{
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}
