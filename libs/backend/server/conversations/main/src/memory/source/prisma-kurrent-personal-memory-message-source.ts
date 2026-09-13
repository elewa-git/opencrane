import { createHash } from "node:crypto";

import { ConversationAuthorKinds, ConversationEntryKinds, ConversationMessageContentBlockKinds, MessageStates, type ConversationEntry, type MessageEntry } from "@opencrane/contracts";
import type { SelfConversationHistoryAuthority } from "../../messages/self-conversation-history.types";
import type { ConversationCaller } from "../../authorization/conversation-caller.types";
import type { PersonalMemoryMessageSourceRead, PersonalMemoryMessageSourceReader } from "./personal-memory-message-source.types";

/** Limits remembered plaintext to the same UTF-8 size accepted by the gateway. */
const _MAX_SOURCE_BYTES = 65_536;
/** Bounds each Kurrent event before the history authority decrypts the selected message. */
const _HISTORY_READ_BYTES = 131_072;
/** Ends a source read that its caller has not cancelled. */
const _HISTORY_READ_TIMEOUT_MS = 10_000;

/** Reads one exact human message through the existing participant history and payload authorities. */
export class PrismaKurrentPersonalMemoryMessageSource implements PersonalMemoryMessageSourceReader
{
	/** Uses the current conversation authority, which owns membership, visibility, and decryption. */
	public constructor(private readonly history: Pick<SelfConversationHistoryAuthority, "read">) {}

	/** Loads the requested message position without fencing against later conversation appends. */
	public async read(caller: ConversationCaller, conversationId: string, messageId: string, messagePosition: bigint, signal?: AbortSignal): Promise<PersonalMemoryMessageSourceRead | null>
	{
		if (messagePosition < 1n)
			return null;
		const readSignal = signal === undefined ? AbortSignal.timeout(_HISTORY_READ_TIMEOUT_MS) : AbortSignal.any([signal, AbortSignal.timeout(_HISTORY_READ_TIMEOUT_MS)]);
		readSignal.throwIfAborted();
		const page = await this.history.read(caller, conversationId, messagePosition - 1n, { maxCount: 1, maximumBytes: _HISTORY_READ_BYTES, signal: readSignal });
		if (page === null || page.entries.length !== 1)
			return null;
		const entry = page.entries[0]!;
		if (!_IsExactHumanMessage(entry, caller, conversationId, messageId, messagePosition))
			return null;
		if (entry.blocks.length !== 1 || entry.blocks[0]!.kind !== ConversationMessageContentBlockKinds.Text)
			return null;
		const block = entry.blocks[0];
		const text = page.payloads[block.payloadRef];
		if (typeof text !== "string" || text.trim().length === 0 || Buffer.byteLength(text, "utf8") > _MAX_SOURCE_BYTES)
			return null;
		const source = { conversationId, messageId, messagePosition, payloadRef: block.payloadRef, ciphertextDigest: block.ciphertextDigest, authorPrincipalId: caller.principalId };
		return { source, text, contentDigest: _Utf8Digest(text) };
	}
}

/** Checks immutable entry identity and human authorship before any source text leaves the authority. */
function _IsExactHumanMessage(entry: ConversationEntry, caller: ConversationCaller, conversationId: string, messageId: string, messagePosition: bigint): entry is MessageEntry
{
	return entry.kind === ConversationEntryKinds.Message
		&& entry.conversationId === conversationId
		&& entry.id === messageId
		&& entry.position === messagePosition.toString()
		&& entry.state === MessageStates.Completed
		&& entry.provenance === "human-authored"
		&& entry.author.kind === ConversationAuthorKinds.Human
		&& entry.author.principalId === caller.principalId
		&& entry.author.participantId === caller.subjectId;
}

/** Hashes the complete UTF-8 bytes that the provider will receive. */
function _Utf8Digest(text: string): string
{
	return `sha256:${createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex")}`;
}
