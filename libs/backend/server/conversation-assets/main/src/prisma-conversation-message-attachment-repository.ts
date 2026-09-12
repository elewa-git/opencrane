import { ConversationAssetProvenance, ConversationAssetState, type Prisma } from "@prisma/client";

import type { ConversationMessageAttachment, ConversationMessageAttachmentAdmission, ConversationMessageAttachmentAdmissionCommand, ConversationMessageAttachmentAdmissionResult } from "@opencrane/backend/server/conversations";
import { PrismaScannedPdfTextRepository } from "@opencrane/backend/server/agents/artifacts";
import { ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";

import { PrismaConversationAssetProductAuthorizationRepository } from "./conversation-asset-product-authorization";

/** Largest combined source-file selection admitted by one conversation message. */
const _MAXIMUM_MESSAGE_FILE_BYTES = 200 * 1_024 * 1_024;

/** Binds participant PDFs to one message in the transaction that creates its encrypted retry row. */
export class PrismaConversationMessageAttachmentRepository implements ConversationMessageAttachmentAdmission
{
	/** Current product decisions share the message's Serializable transaction. */
	private readonly authorization: PrismaConversationAssetProductAuthorizationRepository;
	/** Source and derived revisions are checked by the artifact owner. */
	private readonly lineage: PrismaScannedPdfTextRepository;

	/** The conversation authority owns commit, rollback and the later Kurrent append. */
	constructor(private readonly transaction: Prisma.TransactionClient)
	{
		this.authorization = new PrismaConversationAssetProductAuthorizationRepository(this.transaction);
		this.lineage = new PrismaScannedPdfTextRepository(this.transaction);
	}

	/**
	 * A payload retry must present exactly its original set, including an original empty set.
	 * Bindings survive an uncertain history append: this owner never frees them for a new key.
	 * Null is a denial that the caller must turn into rollback of the whole message transaction.
	 */
	async bindOrVerify(command: ConversationMessageAttachmentAdmissionCommand): Promise<ConversationMessageAttachmentAdmissionResult | null>
	{
		const { caller, conversationId, messageId, canonicalAssetIds, payloadCreated } = command;
		if (canonicalAssetIds.length > 10 || new Set(canonicalAssetIds).size !== canonicalAssetIds.length)
			throw new Error("Conversation attachment idempotency requires a unique bounded set");
		const bound = await this.transaction.conversationAsset.findMany({ where: { siloId: caller.siloId, conversationId, messageId }, select: { id: true } });
		const expected = new Set(canonicalAssetIds);
		if (payloadCreated ? bound.length !== 0 : bound.length !== expected.size || bound.some(asset => !expected.has(asset.id)))
			throw new Error("Conversation attachment idempotency key has a different saved set");
		if (canonicalAssetIds.length === 0)
			return { attachments: [] };
		if (!await this.authorization.canAccess(caller, { kind: ProductAuthorizationResourceKinds.Conversation, id: conversationId }, ProductAuthorizationActions.Use))
			return null;
		const rows = await this.transaction.conversationAsset.findMany({ where: { id: { in: [...canonicalAssetIds] }, siloId: caller.siloId, conversationId } });
		const byId = new Map(rows.map(asset => [asset.id, asset]));
		if (rows.length !== canonicalAssetIds.length || byId.size !== rows.length)
			return null;
		const attachments: ConversationMessageAttachment[] = [];
		let byteLength = 0;
		for (const assetId of canonicalAssetIds)
		{
			const asset = byId.get(assetId)!;
			if (asset.provenance !== ConversationAssetProvenance.ParticipantUpload || asset.createdByUserId !== caller.subjectId
				|| asset.state !== ConversationAssetState.Ready || asset.artifactId === null || asset.revisionId === null
				|| asset.mediaType !== "application/pdf" || asset.byteLength === null
				|| asset.messageId !== (payloadCreated ? null : messageId))
				return null;
			const resource = { kind: ProductAuthorizationResourceKinds.Artifact, id: asset.artifactId };
			if (!await this.authorization.canAccess(caller, resource, ProductAuthorizationActions.Read))
				return null;
			const text = await this.lineage.resolve(caller.siloId, asset.artifactId, asset.revisionId);
			if (text === null || BigInt(text.sourceByteLength) !== asset.byteLength)
				return null;
			byteLength += text.sourceByteLength;
			if (byteLength > _MAXIMUM_MESSAGE_FILE_BYTES)
				return null;
			attachments.push({ assetId, artifactId: asset.artifactId, artifactRevisionId: asset.revisionId, name: asset.displayName, mediaType: asset.mediaType });
		}
		for (const attachment of attachments)
		{
			const resource = { kind: ProductAuthorizationResourceKinds.Artifact, id: attachment.artifactId };
			if (!await this.authorization.admit(caller, resource, ProductAuthorizationActions.Edit, { conversationId, messageId, assetId: attachment.assetId, artifactRevisionId: attachment.artifactRevisionId }))
				return null;
			if (!payloadCreated)
				continue;
			const changed = await this.transaction.conversationAsset.updateMany({
				where: { id: attachment.assetId, siloId: caller.siloId, conversationId, createdByUserId: caller.subjectId,
					messageId: null, state: ConversationAssetState.Ready, artifactId: attachment.artifactId, revisionId: attachment.artifactRevisionId },
				data: { messageId },
			});
			if (changed.count !== 1)
				throw new Error("Conversation attachment idempotency binding changed before commit");
		}
		return { attachments };
	}
}
