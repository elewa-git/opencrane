import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";

import { ConversationHistoryReader } from "@opencrane/backend/server/conversations/history";
import type { HistoryStore } from "@opencrane/backend/server/infra/history-store";
import { ___RunInPrismaUnitOfWork } from "@opencrane/backend/server/infra/prisma-unit-of-work";

import type { ConversationPromptDocumentAuthorityFactory, ConversationPromptDocumentContentReader, ConversationPromptDocumentPreparation, ConversationPromptDocumentPreparationCommand, ConversationPromptDocumentPreparer as ConversationPromptDocumentPreparerPort, ConversationPromptDocumentReference, PreparedConversationPromptDocument, ResolvedConversationPromptDocument } from "./conversation-prompt-document.types";
import { _CollectConversationPromptDocumentReferences } from "./conversation-prompt-document-reference";

const _MAXIMUM_DOCUMENT_COUNT = 10;
const _MAXIMUM_DOCUMENT_BYTES = 64 * 1_024;
const _MAXIMUM_AGGREGATE_DOCUMENT_BYTES = 128 * 1_024;
const _PREPARATION_TIMEOUT_MILLISECONDS = 30_000;

/** Loads converted PDF bytes outside SQL and keeps them only for the current compile. */
export class PrismaConversationPromptDocumentPreparationUnitOfWork implements ConversationPromptDocumentPreparerPort
{
	/** Bind preparation to current history, short SQL checks and the published-byte reader. */
	constructor(private readonly prisma: PrismaClient, private readonly history: Pick<HistoryStore, "readStream">, private readonly authorities: ConversationPromptDocumentAuthorityFactory, private readonly content: ConversationPromptDocumentContentReader) {}

	/** Resolve an exact Kurrent prefix, then verify bounded text bytes after the SQL read ends. */
	async prepare(command: ConversationPromptDocumentPreparationCommand): Promise<ConversationPromptDocumentPreparation>
	{
		const history = await new ConversationHistoryReader(this.history).read({ siloId: command.siloId, conversationId: command.conversationId });
		if ((history.entries.at(-1)?.position ?? "0") !== command.historyRevision)
			throw new Error("Conversation prompt document history revision changed before preparation");
		const references = _CollectConversationPromptDocumentReferences(history.entries, command.orderedMessageIds);
		if (references.length > _MAXIMUM_DOCUMENT_COUNT)
			throw new Error("Conversation prompt exceeds the PDF document count limit");
		const authorityFactory = this.authorities;
		const resolved = await ___RunInPrismaUnitOfWork(this.prisma, function _ResolveDocuments(transaction)
		{
			if (command.requester.siloId !== command.siloId)
				throw new Error("Conversation prompt requester uses another silo");
			return authorityFactory.create(transaction).resolve(command, references);
		}, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, attemptLimit: 1, operation: "conversation-prompt-document-resolution" });
		_RequireExactResolution(references, resolved);
		let aggregateBytes = 0;
		for (const document of resolved)
		{
			if (!Number.isSafeInteger(document.byteLength) || document.byteLength < 1 || document.byteLength > _MAXIMUM_DOCUMENT_BYTES)
				throw new Error("Conversation prompt PDF text exceeds its byte limit");
			aggregateBytes += document.byteLength;
			if (aggregateBytes > _MAXIMUM_AGGREGATE_DOCUMENT_BYTES)
				throw new Error("Conversation prompt PDF text exceeds the aggregate byte limit");
		}
		const signal = AbortSignal.timeout(_PREPARATION_TIMEOUT_MILLISECONDS);
		const documents: PreparedConversationPromptDocument[] = [];
		for (const document of resolved)
			documents.push({ ...document, text: await this._ReadText(document, signal) });
		return { siloId: command.siloId, conversationId: command.conversationId, historyRevision: command.historyRevision, orderedMessageIds: [...command.orderedMessageIds], documents };
	}

	/** Read one immutable revision without truncating, then check its exact digest and fatal UTF-8. */
	private async _ReadText(document: ResolvedConversationPromptDocument, signal: AbortSignal): Promise<string>
	{
		const stream = await this.content.read({ siloId: document.siloId, artifactId: document.artifactId, artifactRevisionId: document.artifactRevisionId }, signal);
		const reader = stream.getReader();
		const chunks: Uint8Array[] = [];
		const digest = createHash("sha256");
		let byteLength = 0;
		try
		{
			while (true)
			{
				signal.throwIfAborted();
				const next = await reader.read();
				if (next.done)
					break;
				byteLength += next.value.byteLength;
				if (byteLength > document.byteLength || byteLength > _MAXIMUM_DOCUMENT_BYTES)
					throw new Error("Conversation prompt PDF text returned too many bytes");
				chunks.push(next.value);
				digest.update(next.value);
			}
		}
		catch (error)
		{
			await reader.cancel(error).catch(function _IgnoreCancellationFailure() { /* The original read failure is authoritative. */ });
			throw error;
		}
		finally { reader.releaseLock(); }
		if (byteLength !== document.byteLength || `sha256:${digest.digest("hex")}` !== document.contentAddress)
			throw new Error("Conversation prompt PDF text does not match its published revision");
		const bytes = new Uint8Array(byteLength);
		let offset = 0;
		for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
		const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
		if (text.length === 0)
			throw new Error("Conversation prompt PDF text is empty");
		return text;
	}
}

/** Require the SQL authority to preserve every Kurrent reference and its order. */
function _RequireExactResolution(references: readonly ConversationPromptDocumentReference[], resolved: readonly ResolvedConversationPromptDocument[]): void
{
	if (resolved.length !== references.length || resolved.some(function _Mismatch(document, index): boolean
	{
		const reference = references[index]!;
		return document.messageId !== reference.messageId || document.blockId !== reference.blockId || document.sourceArtifactId !== reference.sourceArtifactId
			|| document.sourceRevisionId !== reference.sourceRevisionId || document.name !== reference.name || document.mediaType !== reference.mediaType;
	}))
		throw new Error("Conversation prompt document authority returned another reference set");
}
