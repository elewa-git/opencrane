import { describe, expect, it } from "vitest";

import { _ConversationAssetsOpenapiPaths } from "../openapi.js";

describe("conversation asset OpenAPI", function _Suite()
{
	it("publishes list, reservation, and exact byte-upload operations", function _PublishesOperations()
	{
		expect(_ConversationAssetsOpenapiPaths["/me/conversations/{conversationId}/assets"].get.operationId).toBe("listMyConversationAssets");
		expect(_ConversationAssetsOpenapiPaths["/me/conversations/{conversationId}/assets"].post.operationId).toBe("reserveMyConversationAssetUpload");
		expect(_ConversationAssetsOpenapiPaths["/me/conversations/{conversationId}/assets/{assetId}/content"].put.requestBody.content["application/octet-stream"].schema).toEqual({ type: "string", format: "binary" });
	});

	it("does not describe hidden storage or scanner authority fields", function _KeepsAuthorityHidden()
	{
		const specification = JSON.stringify(_ConversationAssetsOpenapiPaths);
		for (const forbidden of ["storageUrl", "leaseId", "receipt", "claimFence", "scannerVersion"]) expect(specification).not.toContain(`\"${forbidden}\":`);
	});
});
