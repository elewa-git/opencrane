import { Injectable, inject } from "@angular/core";

import { ControlPlaneApiService } from "@opencrane/core";

import type { ConversationAsset, ReserveConversationAssetUpload } from "./conversation-assets.types";
import type { ConversationAssetsGateway } from "./conversation-assets-gateway.types";
import { _ParseConversationAsset } from "./conversation-assets.validator";

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
		return data.assets.map(_ParseConversationAsset);
	}

	/** @inheritdoc */
	public async read(conversationId: string, assetId: string): Promise<Blob>
	{
		const { data, error } = await this._api.client.GET("/me/conversations/{conversationId}/assets/{assetId}/content", { params: { path: { conversationId, assetId } }, parseAs: "blob" });
		if (error !== undefined || !(data instanceof Blob)) throw new Error("The file could not be opened.");
		return data;
	}

	/** @inheritdoc */
	public async reserve(conversationId: string, request: ReserveConversationAssetUpload): Promise<ConversationAsset>
	{
		const { data, error } = await this._api.client.POST("/me/conversations/{conversationId}/assets", { params: { path: { conversationId } }, body: request });
		if (error !== undefined || data === undefined) throw new Error("The file upload could not be reserved.");
		return _ParseConversationAsset(data.asset);
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
		return _ParseConversationAsset(data.asset);
	}

	/** @inheritdoc */
	public async remove(conversationId: string, assetId: string): Promise<ConversationAsset>
	{
		const { data, error } = await this._api.client.DELETE("/me/conversations/{conversationId}/assets/{assetId}", { params: { path: { conversationId, assetId } } });
		if (error !== undefined || data === undefined) throw new Error("The file could not be removed.");
		return _ParseConversationAsset(data.asset);
	}
}
