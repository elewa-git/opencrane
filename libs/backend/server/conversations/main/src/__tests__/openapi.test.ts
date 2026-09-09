import { describe, expect, it } from "vitest";

import { _SelfConversationHistoryOpenapiPaths } from "../openapi";

describe("_SelfConversationHistoryOpenapiPaths", function _DescribeOpenapi()
{
	it("publishes the exclusive history cursor and encrypted message operations", function _PublishesPaths()
	{
		expect(_SelfConversationHistoryOpenapiPaths["/me/conversations/{conversationId}/history"].get.operationId).toBe("readMyConversationHistory");
		expect(_SelfConversationHistoryOpenapiPaths["/me/conversations/{conversationId}/history"].get.parameters[1]?.description).toContain("Exclusive");
		expect(_SelfConversationHistoryOpenapiPaths["/me/conversations/{conversationId}/messages"].post.operationId).toBe("postMyConversationMessage");
		expect(JSON.stringify(_SelfConversationHistoryOpenapiPaths)).not.toContain("authTag");
	});

	it("binds every metadata detail operation to its required conversation path coordinate", function _PublishesMetadataCoordinates()
	{
		expect(_SelfConversationHistoryOpenapiPaths["/me/conversations/{conversationId}"].get.parameters).toContainEqual({ name: "conversationId", in: "path", required: true, schema: { type: "string" } });
		expect(_SelfConversationHistoryOpenapiPaths["/me/conversations/{conversationId}/archive"].patch.parameters).toContainEqual({ name: "conversationId", in: "path", required: true, schema: { type: "string" } });
		expect(_SelfConversationHistoryOpenapiPaths["/me/conversations/{conversationId}/close"].post.parameters).toContainEqual({ name: "conversationId", in: "path", required: true, schema: { type: "string" } });
	});
});
