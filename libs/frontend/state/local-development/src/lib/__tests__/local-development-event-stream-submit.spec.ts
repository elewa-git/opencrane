import { Injector } from "@angular/core";
import { describe, expect, it } from "vitest";

import { MessageContentBlockKinds } from "@opencrane/models/conversations";
import { ConversationEventStreamMessageError } from "@opencrane/state/conversation/stream";
import { CONVERSATION_WORKSPACE_EVENT_STREAM, CONVERSATION_WORKSPACE_GATEWAY, type ConversationWorkspaceGateway } from "@opencrane/state/conversation/workspace";

import { provideLocalDevelopmentGateways } from "../local-development.providers";

describe("LocalDevelopmentConversationEventStream.submit", function _Suite()
{
	it("admits the message into the shared local workspace", async function _Submit()
	{
		const injector = Injector.create({ providers: provideLocalDevelopmentGateways() });
		const stream = injector.get(CONVERSATION_WORKSPACE_EVENT_STREAM);
		const workspace = injector.get<ConversationWorkspaceGateway>(CONVERSATION_WORKSPACE_GATEWAY);
		const before = await workspace.open("conversation-agent");

		await stream.submit({
			conversationId: before.id,
			idempotencyKey: "stream-message-local-1",
			blocks: [
				{
					id: "stream-block-local-1",
					kind: MessageContentBlockKinds.Text,
					value: "Keep this command on the selected local conversation."
				}
			]
		});

		expect((await workspace.open(before.id)).messages).toHaveLength(before.messages.length + 2);
	});

	it("rejects unsupported participant block kinds", async function _UnsupportedBlock()
	{
		const stream = Injector.create({ providers: provideLocalDevelopmentGateways() }).get(CONVERSATION_WORKSPACE_EVENT_STREAM);

		await expect(stream.submit({
			conversationId: "conversation-agent",
			idempotencyKey: "stream-message-local-unsupported",
			blocks: [
				{
					id: "stream-block-local-unsupported",
					kind: "unsupported",
					value: "Unsupported"
				}
			]
		})).rejects.toBeInstanceOf(ConversationEventStreamMessageError);
	});
});
