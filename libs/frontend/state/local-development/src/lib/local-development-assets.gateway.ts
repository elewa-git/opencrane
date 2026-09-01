import { Injectable, inject } from "@angular/core";

import { ConversationAssetDisposition, ConversationAssetLifecycle, ConversationAssetProvenance } from "@opencrane/models/conversation-assets";
import type { ConversationAsset, ConversationAssetsGateway, ReserveConversationAssetUpload } from "@opencrane/state/conversation/assets";

import { LocalDevelopmentState } from "./local-development-state";

/**
 * Implements the conversation-file lifecycle without persisting selected bytes. Metadata survives
 * route changes in shared Tier 1 state, while reads return fixture content instead of the user's
 * original file.
 */
@Injectable()
export class LocalDevelopmentConversationAssetsGateway implements ConversationAssetsGateway
{
	/** Shared browser-session state used by workspace messages and asset selection. */
	private readonly _state = inject(LocalDevelopmentState);

	/** List retained assets for the selected conversation. */
	public async list(conversationId: string): Promise<readonly ConversationAsset[]>
	{
		return Array.from(this._state.assets.values()).filter(function _ForConversation(asset) { return asset.conversationId === conversationId; });
	}

	/** Return deterministic fixture bytes for a ready local asset. */
	public async read(conversationId: string, assetId: string): Promise<Blob>
	{
		const asset = this._state.assets.get(assetId);

		if (asset?.conversationId !== conversationId || asset.state !== ConversationAssetLifecycle.Ready)
		{
			throw new Error("The asset is not ready to read.");
		}

		return new Blob(["OpenCrane Tier 1 local-development asset."], { type: asset.mediaType });
	}

	/** Reserve asset metadata without retaining selected file bytes. */
	public async reserve(conversationId: string, request: ReserveConversationAssetUpload): Promise<ConversationAsset>
	{
		const asset: ConversationAsset = { id: this._state.nextId("asset"), conversationId, messageId: null, provenance: ConversationAssetProvenance.ParticipantUpload, state: ConversationAssetLifecycle.Uploading, displayName: request.displayName, mediaType: request.mediaType, byteLength: request.byteLength, disposition: null, failureCode: null, canRemove: true, createdAt: "2026-08-21T10:10:00.000Z" };
		this._state.assets.set(asset.id, asset);
		return asset;
	}

	/** Mark a reserved local asset ready without persisting the supplied browser file. */
	public async upload(conversationId: string, assetId: string, _file: File): Promise<ConversationAsset>
	{
		const asset = this._state.assets.get(assetId);

		if (asset?.conversationId !== conversationId)
		{
			throw new Error("The asset reservation changed.");
		}

		const ready = { ...asset, state: ConversationAssetLifecycle.Ready, disposition: asset.mediaType.startsWith("image/") || asset.mediaType === "application/pdf" ? ConversationAssetDisposition.Preview : ConversationAssetDisposition.Download, canRemove: true };
		this._state.assets.set(assetId, ready);
		return ready;
	}

	/** Mark an unbound local asset removed. */
	public async remove(conversationId: string, assetId: string): Promise<ConversationAsset>
	{
		const asset = this._state.assets.get(assetId);

		if (asset?.conversationId !== conversationId)
		{
			throw new Error("The asset is unavailable.");
		}

		const removed = { ...asset, state: ConversationAssetLifecycle.Removed, canRemove: false };
		this._state.assets.set(assetId, removed);
		return removed;
	}
}
