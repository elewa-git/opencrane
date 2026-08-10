import { describe, expect, it } from "vitest";

import { _SelfConversationsOpenapiPaths } from "../openapi.js";

/** Returns the JSON success schema for one participant conversation operation. */
function _SuccessSchema(path: keyof typeof _SelfConversationsOpenapiPaths, method: "get" | "patch" | "post", status: 200 | 201): object
{
	const paths = _SelfConversationsOpenapiPaths as unknown as Record<string, Record<string, { readonly responses: Record<number, { readonly content?: { readonly "application/json"?: { readonly schema: object } } }> }>>;
	const operation = paths[path][method];
	return operation.responses[status].content?.["application/json"]?.schema ?? {};
}

describe("participant conversation OpenAPI", function _Suite()
{
	it("returns exact summary rows from the list operation", function _ListsSummaries()
	{
		const schema = _SuccessSchema("/me/conversations", "get", 200);
		expect(schema).toMatchObject({
			additionalProperties: false,
			required: ["conversations"],
			properties: { conversations: { items: { additionalProperties: false, required: ["id", "mode", "lifecycle", "agentServiceId", "participantUserIds", "archivedAt", "readThroughPosition", "updatedAt"] } } },
		});
	});

	it("returns conversation detail from create, open, archive, and close", function _ReturnsDetails()
	{
		const detailSchemas = [
			_SuccessSchema("/me/conversations", "post", 201),
			_SuccessSchema("/me/conversations/{conversationId}", "get", 200),
			_SuccessSchema("/me/conversations/{conversationId}/archive", "patch", 200),
			_SuccessSchema("/me/conversations/{conversationId}/close", "post", 200),
		];

		for (const schema of detailSchemas)
		{
			expect(schema).toMatchObject({
				additionalProperties: false,
				required: ["conversation"],
				properties: { conversation: { additionalProperties: false, required: expect.arrayContaining(["visibleFromPosition", "accessEndedPosition", "messages"]), properties: { messages: { items: { additionalProperties: false, required: ["id", "position", "role", "state", "source", "blocks", "runId", "userId", "createdAt", "completedAt"] } } } } },
			});
		}
	});

	it("distinguishes accepted writes from idempotent message replays", function _ReturnsMessageOutcomes()
	{
		const accepted = _SuccessSchema("/me/conversations/{conversationId}/messages", "post", 201);
		const idempotent = _SuccessSchema("/me/conversations/{conversationId}/messages", "post", 200);

		expect(accepted).toMatchObject({ additionalProperties: false, required: ["outcome", "message"], properties: { outcome: { enum: ["accepted"] } } });
		expect(idempotent).toMatchObject({ additionalProperties: false, required: ["outcome", "message"], properties: { outcome: { enum: ["idempotent"] } } });
		expect(accepted).toMatchObject({ properties: { message: { properties: { blocks: { items: { properties: { kind: { enum: ["text", "artifact", "tool_call", "tool_result"] } } } } } } } });
	});
});
