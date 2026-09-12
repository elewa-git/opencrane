import { ConversationAssetProvenance, ConversationAssetState, type Prisma } from "@prisma/client";

import { PrismaScannedPdfTextRepository } from "@opencrane/backend/server/agents/artifacts";
import type { ConversationPromptDocumentAuthority, ConversationPromptDocumentPreparation, ConversationPromptDocumentPreparationCommand, ConversationPromptDocumentReference, ResolvedConversationPromptDocument } from "@opencrane/backend/server/conversations";

import { PrismaConversationAssetRepository } from "../prisma-conversation-asset-repository";

/** Resolves message-bound participant PDFs through current access and converted-text lineage. */
export class PrismaConversationPromptDocumentRepository implements ConversationPromptDocumentAuthority
{
	/** Bind every authority read to the run compiler's transaction snapshot. */
	constructor(private readonly transaction: Prisma.TransactionClient) {}

	/** Resolve each Kurrent block through one ready asset and its current converted text. */
	async resolve(command: ConversationPromptDocumentPreparationCommand, references: readonly ConversationPromptDocumentReference[]): Promise<readonly ResolvedConversationPromptDocument[]>
	{
		if (command.requester.siloId !== command.siloId || new Set(references.map(reference => reference.blockId)).size !== references.length)
			throw new Error("Conversation prompt document references are invalid");
		const assets = new PrismaConversationAssetRepository(this.transaction);
		const lineage = new PrismaScannedPdfTextRepository(this.transaction);
		const resolved: ResolvedConversationPromptDocument[] = [];
		const selectedAssetIds = new Set<string>();
		for (const reference of references)
		{
			if (reference.mediaType !== "application/pdf")
				throw new Error("Conversation prompt document must be a PDF");
			const rows = await this.transaction.conversationAsset.findMany({
				where: { siloId: command.siloId, conversationId: command.conversationId, messageId: reference.messageId,
					artifactId: reference.sourceArtifactId, revisionId: reference.sourceRevisionId },
			});
			if (rows.length !== 1)
				throw new Error("Conversation prompt document message binding is unavailable");
			const row = rows[0]!;
			if (selectedAssetIds.has(row.id))
				throw new Error("Conversation prompt document repeats a message-bound asset");
			selectedAssetIds.add(row.id);
			if (row.provenance !== ConversationAssetProvenance.ParticipantUpload || row.state !== ConversationAssetState.Ready
				|| row.createdByUserId !== command.requester.subjectId || row.displayName !== reference.name || row.mediaType !== reference.mediaType || row.byteLength === null)
				throw new Error("Conversation prompt document source is unavailable");
			const target = await assets.readReadyTarget(command.requester, command.conversationId, row.id);
			if (target === null || target.artifactId !== reference.sourceArtifactId || target.artifactRevisionId !== reference.sourceRevisionId
				|| target.displayName !== reference.name || target.mediaType !== reference.mediaType || target.byteLength !== Number(row.byteLength))
				throw new Error("Conversation prompt document source authority is unavailable");
			const text = await lineage.resolve(command.siloId, reference.sourceArtifactId, reference.sourceRevisionId);
			if (text === null || text.sourceByteLength !== target.byteLength)
				throw new Error("Conversation prompt document conversion is unavailable");
			resolved.push({ ...reference, siloId: command.siloId, conversationAssetId: row.id, sourceByteLength: text.sourceByteLength,
				artifactId: text.artifactId, artifactRevisionId: text.artifactRevisionId, contentAddress: text.contentAddress,
				byteLength: text.byteLength, derivedMediaType: text.mediaType });
		}
		return resolved;
	}

	/** Repeat every source and lineage check, then compare the complete prepared coordinate set. */
	async revalidate(command: ConversationPromptDocumentPreparationCommand, prepared: ConversationPromptDocumentPreparation): Promise<void>
	{
		if (prepared.siloId !== command.siloId || prepared.conversationId !== command.conversationId || prepared.historyRevision !== command.historyRevision
			|| !_SameStrings(prepared.orderedMessageIds, command.orderedMessageIds))
			throw new Error("Conversation prompt document preparation uses different command coordinates");
		const references = prepared.documents.map(function _Reference(document): ConversationPromptDocumentReference
		{
			return { messageId: document.messageId, blockId: document.blockId, sourceArtifactId: document.sourceArtifactId,
				sourceRevisionId: document.sourceRevisionId, name: document.name, mediaType: document.mediaType };
		});
		const current = await this.resolve(command, references);
		if (current.length !== prepared.documents.length || current.some(function _Changed(document, index): boolean
		{
			const prior = prepared.documents[index]!;
			return document.conversationAssetId !== prior.conversationAssetId || document.siloId !== prior.siloId
				|| document.sourceByteLength !== prior.sourceByteLength || document.artifactId !== prior.artifactId
				|| document.artifactRevisionId !== prior.artifactRevisionId || document.contentAddress !== prior.contentAddress
				|| document.byteLength !== prior.byteLength || document.derivedMediaType !== prior.derivedMediaType;
		}))
			throw new Error("Conversation prompt document authority changed during compilation");
	}
}

/** Compare exact ordered message identifiers without accepting set equivalence. */
function _SameStrings(left: readonly string[], right: readonly string[]): boolean
{
	return left.length === right.length && left.every(function _Same(value, index): boolean { return value === right[index]; });
}
