import { describe, expect, it } from "vitest";

import { ConversationAssetProvenance } from "@opencrane/models/conversation-assets";
import { _ConversationAssetsOpenapiPaths } from "../openapi";

describe("conversation asset OpenAPI", function _Suite()
{
	it("describes generated-file metadata alongside participant uploads", function _GeneratedFileProvenance()
	{
		const schema = _ConversationAssetsOpenapiPaths["/me/conversations/{conversationId}/assets"].get.responses[200].content["application/json"].schema.properties.assets.items;
		expect(schema.properties.provenance.enum).toEqual([ConversationAssetProvenance.ParticipantUpload, ConversationAssetProvenance.AgentOutput]);
	});

	it("publishes list, reservation, authorized read, exact byte-upload, and removal operations", function _PublishesOperations()
	{
		expect(_ConversationAssetsOpenapiPaths["/me/conversations/{conversationId}/assets"].get.operationId).toBe("listMyConversationAssets");
		expect(_ConversationAssetsOpenapiPaths["/me/conversations/{conversationId}/assets"].post.operationId).toBe("reserveMyConversationAssetUpload");
		expect(_ConversationAssetsOpenapiPaths["/me/conversations/{conversationId}/assets/{assetId}/content"].get.operationId).toBe("readMyConversationAssetContent");
		expect(_ConversationAssetsOpenapiPaths["/me/conversations/{conversationId}/assets/{assetId}/content"].put.requestBody.content["application/octet-stream"].schema).toEqual({ type: "string", format: "binary" });
		expect(_ConversationAssetsOpenapiPaths["/me/conversations/{conversationId}/assets/{assetId}"].delete.operationId).toBe("removeMyConversationAsset");
	});

	it("does not describe hidden storage or scanner authority fields", function _KeepsAuthorityHidden()
	{
		const specification = JSON.stringify(_ConversationAssetsOpenapiPaths);
		for (const forbidden of ["storageUrl", "leaseId", "receipt", "claimFence", "scannerVersion"]) expect(specification).not.toContain(`\"${forbidden}\":`);
	});
});
