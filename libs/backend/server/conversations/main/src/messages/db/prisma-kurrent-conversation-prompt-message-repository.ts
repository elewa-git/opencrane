import type { Prisma } from "@prisma/client";

import type { CompiledMessage, ConversationAuthor, MessageEntry } from "@opencrane/contracts";
import type { ConversationPromptMessageRead, ConversationPromptMessageSource } from "@opencrane/backend/agents/execution/inputs";
import type { HistoryStore } from "@opencrane/backend/server/infra/history-store";

import type { ConversationCaller } from "../../authorization/conversation-caller.types";
import { PrismaConversationHistoryRepository } from "./prisma-conversation-history-repository";
import { ConversationHistoryReader } from "@opencrane/backend/server/conversations/history";
import type { ConversationPrivatePayloadCipher } from "@opencrane/backend/server/conversations/history";

/** Resolves exact Kurrent message identifiers through coordinate-bound encrypted payload rows. */
export class PrismaKurrentConversationPromptMessageRepository implements ConversationPromptMessageSource
{
	/** Create one command-bound source that cannot read another conversation or history revision. */
	constructor(private readonly _prisma: Prisma.TransactionClient, private readonly _history: Pick<HistoryStore, "readStream">, private readonly _cipher: ConversationPrivatePayloadCipher, private readonly _siloId: string, private readonly _conversationId: string, private readonly _historyRevision: string, private readonly _requester?: ConversationCaller) {}

	/** Load and decrypt the requested messages only when every history and payload binding matches exactly. */
	async load(messageIds: readonly string[]): Promise<readonly ConversationPromptMessageRead[]>
	{
		const child = await this._prisma.conversationChildRequest.findUnique({ where: { childConversationId: this._conversationId }, select: { id: true } });
		if (child !== null && (this._requester === undefined || this._requester.siloId !== this._siloId || await new PrismaConversationHistoryRepository(this._prisma).authorizeRead(this._requester, this._conversationId) === null))
			throw new Error("Conversation child prompt requires current parent and child authority");
		const reader = new ConversationHistoryReader(this._history);
		const history = await reader.read({ siloId: this._siloId, conversationId: this._conversationId });
		if ((history.entries.at(-1)?.position ?? "0") !== this._historyRevision)
			throw new Error("Conversation prompt history revision changed after admission");
		const messages = new Map(history.entries.filter(function _CompletedMessage(entry): entry is MessageEntry { return entry.kind === "message" && entry.state === "completed"; }).map(message => [message.id, message]));
		const selected = messageIds.map(messageId => messages.get(messageId));
		if (selected.some(message => message === undefined))
			throw new Error("Conversation prompt message is absent from canonical history");
		const exactMessages = selected as readonly MessageEntry[];
		const blocks = exactMessages.flatMap(message => message.blocks.filter(function _TextBlock(block) { return block.kind === "text"; }).map(block => ({ block, message })));
		const payloadRefs = blocks.map(value => value.block.payloadRef);
		if (new Set(payloadRefs).size !== payloadRefs.length)
			throw new Error("Conversation prompt history repeats a private payload reference");
		const payloads = await this._prisma.conversationPrivatePayload.findMany({ where: { siloId: this._siloId, conversationId: this._conversationId, id: { in: payloadRefs } } });
		if (payloads.length !== payloadRefs.length)
			throw new Error("Conversation prompt private payload set is incomplete");
		const byId = new Map(payloads.map(payload => [payload.id, payload]));
		return exactMessages.map(message => ({ messageId: message.id, message: this._CompileMessage(message, byId) }));
	}

	/** Decrypt every text block after its row, author, coordinates, and ciphertext digest agree with history. */
	private _CompileMessage(message: MessageEntry, payloads: ReadonlyMap<string, Awaited<ReturnType<Prisma.TransactionClient["conversationPrivatePayload"]["findMany"]>>[number]>): CompiledMessage
	{
		const authorSubject = _AuthorSubject(message.author);
		const content = message.blocks.flatMap(block =>
		{
			if (block.kind !== "text")
				return [];
			const payload = payloads.get(block.payloadRef);
			if (payload === undefined || payload.siloId !== this._siloId || payload.conversationId !== this._conversationId || payload.authorSubject !== authorSubject || payload.ciphertextDigest !== block.ciphertextDigest)
				throw new Error("Conversation prompt private payload does not match canonical history");
			const encrypted = { keyId: payload.keyId, nonce: payload.nonce, authTag: payload.authTag, ciphertext: payload.ciphertext, ciphertextDigest: payload.ciphertextDigest };
			return [this._cipher.decrypt(encrypted, { siloId: this._siloId, conversationId: this._conversationId, payloadRef: payload.id, authorSubject })];
		}).join("\n");
		return { role: _Role(message.author), content };
	}
}

/** Resolve the immutable author coordinate authenticated into a private payload. */
function _AuthorSubject(author: ConversationAuthor): string
{
	if (author.kind === "human")
		return author.participantId;
	if (author.kind === "agent")
		return author.agentIdentityId;
	if (author.kind === "service")
		return author.serviceId;
	return author.systemId;
}

/** Map conversation authors onto the closed model-message roles. */
function _Role(author: ConversationAuthor): CompiledMessage["role"]
{
	if (author.kind === "human")
		return "user";
	if (author.kind === "agent")
		return "assistant";
	return "system";
}
