import { describe, expect, it } from "vitest";
import { ConversationLifecycles, ConversationModes, MessageContentBlockKinds, MessageRoles, MessageSources, MessageStates } from "@opencrane/models/conversations";

import { _SelfConversationsOpenapiPaths } from "../openapi.js";

/** Returns the JSON success schema for one participant conversation operation. */
function _SuccessSchema(path: keyof typeof _SelfConversationsOpenapiPaths, method: "get" | "patch" | "post" | "put", status: 200 | 201): object
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
			properties: { conversations: { items: { additionalProperties: false, required: ["id", "mode", "lifecycle", "agentServiceId", "participantRefs", "archivedAt", "readThroughPosition", "updatedAt"] } } },
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
				properties: { conversation: { additionalProperties: false, required: expect.arrayContaining(["visibleFromPosition", "accessEndedPosition", "messages"]), properties: { messages: { items: { additionalProperties: false, required: ["id", "position", "role", "state", "source", "blocks", "runId", "participantRef", "createdAt", "completedAt", "agentThread"] } } } } },
			});
		}
	});

	it("publishes the privacy-safe creation directory", function _PublishesDirectory()
	{
		const schema = _SuccessSchema("/me/conversations/directory", "get", 200);
		expect(schema).toMatchObject({ properties: { directory: { required: ["participants", "personalAgentStatus", "personalAgent"], properties: { participants: { items: { required: ["participantRef", "isSelf"] } } } } } });
		expect(JSON.stringify(schema)).not.toContain("subject");
		expect(JSON.stringify(schema)).not.toContain("email");
	});

	it("distinguishes accepted writes from idempotent message replays", function _ReturnsMessageOutcomes()
	{
		const accepted = _SuccessSchema("/me/conversations/{conversationId}/messages", "post", 201);
		const idempotent = _SuccessSchema("/me/conversations/{conversationId}/messages", "post", 200);

		expect(accepted).toMatchObject({ additionalProperties: false, required: ["outcome", "message", "agentThread"], properties: { outcome: { enum: ["accepted"] } } });
		expect(idempotent).toMatchObject({ additionalProperties: false, required: ["outcome", "message", "agentThread"], properties: { outcome: { enum: ["idempotent"] } } });
		expect(accepted).toMatchObject({ properties: { message: { properties: {
			role: { enum: Object.values(MessageRoles) },
			state: { enum: Object.values(MessageStates) },
			source: { enum: Object.values(MessageSources) },
			blocks: { items: { properties: { kind: { enum: Object.values(MessageContentBlockKinds) } } } },
		} } } });
	});

	it("keeps conversation OpenAPI vocabularies owned by the domain model", function _OwnsConversationVocabularies()
	{
		const list = _SuccessSchema("/me/conversations", "get", 200) as { readonly properties: { readonly conversations: { readonly items: { readonly properties: Record<string, { readonly enum: readonly string[] }> } } } };
		expect(list.properties.conversations.items.properties.mode.enum).toEqual(Object.values(ConversationModes));
		expect(list.properties.conversations.items.properties.lifecycle.enum).toEqual(Object.values(ConversationLifecycles));
	});

	it("publishes exact Agent-thread read-coordinate outcomes", function _MarksAgentThreadRead()
	{
		const schema = _SuccessSchema("/me/conversations/{parentConversationId}/agent-threads/{childConversationId}/read-through", "put", 200);
		expect(schema).toMatchObject({ additionalProperties: false, required: ["outcome", "readThroughPosition"], properties: { outcome: { enum: ["changed", "idempotent"] }, readThroughPosition: { pattern: "^(0|[1-9][0-9]*)$" } } });
	});

	it("publishes distinct started and idempotent run-retry outcomes", function _RetriesRun()
	{
		const started = _SuccessSchema("/me/conversations/{conversationId}/runs/{runId}/retry", "post", 201);
		const idempotent = _SuccessSchema("/me/conversations/{conversationId}/runs/{runId}/retry", "post", 200);

		expect(started).toMatchObject({ additionalProperties: false, required: ["outcome", "runId", "attempt"], properties: { outcome: { enum: ["started"] }, attempt: { minimum: 2 } } });
		expect(idempotent).toMatchObject({ additionalProperties: false, required: ["outcome", "runId", "attempt"], properties: { outcome: { enum: ["idempotent"] }, attempt: { minimum: 2 } } });
	});
});
