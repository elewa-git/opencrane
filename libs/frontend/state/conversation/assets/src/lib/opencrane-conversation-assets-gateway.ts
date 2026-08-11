import { Injectable, inject } from "@angular/core";

import { ControlPlaneApiService } from "@opencrane/core";
import { ConversationAssetDisposition, ConversationAssetLifecycle, ConversationAssetProvenance } from "@opencrane/models/conversation-assets";

import type { ConversationAsset, ReserveConversationAssetUpload } from "./conversation-assets.types.js";
import type { ConversationAssetsGateway } from "./conversation-assets-gateway.types.js";

/** Generated-client adapter for safe conversation-file metadata and exact byte uploads. */
@Injectable()
export class OpenCraneConversationAssetsGateway implements ConversationAssetsGateway
{
	private readonly _api = inject(ControlPlaneApiService);

	/** @inheritdoc */
	public async list(conversationId: string): Promise<readonly ConversationAsset[]>
	{
		const { data, error } = await this._api.client.GET("/me/conversations/{conversationId}/assets", { params: { path: { conversationId } } });
		if (error !== undefined || data === undefined) throw new Error("Conversation files could not be loaded.");
		return data.assets.map(_Asset);
	}

	/** @inheritdoc */
	public async reserve(conversationId: string, request: ReserveConversationAssetUpload): Promise<ConversationAsset>
	{
		const { data, error } = await this._api.client.POST("/me/conversations/{conversationId}/assets", { params: { path: { conversationId } }, body: request });
		if (error !== undefined || data === undefined) throw new Error("The file upload could not be reserved.");
		return _Asset(data.asset);
	}

	/** @inheritdoc */
	public async upload(conversationId: string, assetId: string, file: File): Promise<ConversationAsset>
	{
		const { data, error } = await this._api.client.PUT("/me/conversations/{conversationId}/assets/{assetId}/content", {
			params: { path: { conversationId, assetId } },
			body: file as unknown as string,
			bodySerializer: function _ExactBytes(body): BodyInit { return body as unknown as File; },
			headers: { "Content-Type": file.type || "application/octet-stream" }
		});
		if (error !== undefined || data === undefined) throw new Error("The file upload failed.");
		return _Asset(data.asset);
	}
}

/** Convert generated literals to the owning string-backed enums after the schema validated them. */
function _Asset(asset: { readonly id: string; readonly conversationId: string; readonly messageId: string | null; readonly provenance: "participant_upload" | "agent_output"; readonly state: "uploading" | "processing" | "ready" | "failed" | "cancelled" | "removed"; readonly displayName: string; readonly mediaType: string; readonly byteLength: number | null; readonly disposition: "preview" | "download" | null; readonly failureCode: string | null; readonly createdAt: string }): ConversationAsset
{
	return { ...asset, provenance: asset.provenance as ConversationAssetProvenance, state: asset.state as ConversationAssetLifecycle, disposition: asset.disposition as ConversationAssetDisposition | null };
}
