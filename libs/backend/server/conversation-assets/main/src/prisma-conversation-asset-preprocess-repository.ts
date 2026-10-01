import { ConversationAssetProvenance, ConversationAssetState, type Prisma } from "@prisma/client";

import { PrismaScannedPdfTextRepository, type ConversationAssetPreprocessLifecycleRepository } from "@opencrane/backend/server/agents/artifacts";

/** Updates the source file in the same transaction that ends its PDF conversion job. */
export class PrismaConversationAssetPreprocessRepository implements ConversationAssetPreprocessLifecycleRepository
{
	/** Shares the artifact job's transaction; this repository never opens or commits one. */
	constructor(private readonly transaction: Prisma.TransactionClient) {}

	/** Publishes readiness only when the source PDF has its complete, clean text lineage. */
	async complete(sourceRevisionId: string): Promise<void>
	{
		const asset = await this._Source(sourceRevisionId);
		if (asset === null)
			return;
		const lineage = new PrismaScannedPdfTextRepository(this.transaction);
		if (asset.artifactId === null || await lineage.resolve(asset.siloId, asset.artifactId, sourceRevisionId) === null)
			throw new Error("Completed conversation PDF has no readable text lineage");
		await this._Transition(asset.id, sourceRevisionId, ConversationAssetState.Ready);
	}

	/** Keeps a failed PDF visible with a safe reason and no model-input readiness. */
	async fail(sourceRevisionId: string): Promise<void>
	{
		const asset = await this._Source(sourceRevisionId);
		if (asset !== null)
			await this._Transition(asset.id, sourceRevisionId, ConversationAssetState.Failed);
	}

	/** General artifact uploads have no conversation asset; ambiguous source bindings fail closed. */
	private async _Source(sourceRevisionId: string)
	{
		const rows = await this.transaction.conversationAsset.findMany({ where: { revisionId: sourceRevisionId },
			select: { id: true, siloId: true, artifactId: true, state: true, provenance: true, mediaType: true } });
		if (rows.length === 0)
			return null;
		if (rows.length !== 1 || rows[0]!.state !== ConversationAssetState.Processing
			|| rows[0]!.provenance !== ConversationAssetProvenance.ParticipantUpload || rows[0]!.mediaType !== "application/pdf")
			throw new Error("PDF conversion does not own one Processing conversation file");
		return rows[0]!;
	}

	/** A lost compare-and-set aborts the job transition instead of leaving a false terminal result. */
	private async _Transition(assetId: string, sourceRevisionId: string, state: ConversationAssetState): Promise<void>
	{
		const failureCode = state === ConversationAssetState.Failed ? "preprocessing_failed" : null;
		const changed = await this.transaction.conversationAsset.updateMany({
			where: { id: assetId, revisionId: sourceRevisionId, state: ConversationAssetState.Processing }, data: { state, failureCode },
		});
		if (changed.count !== 1)
			throw new Error("Conversation PDF lifecycle changed before preprocessing committed");
	}
}
