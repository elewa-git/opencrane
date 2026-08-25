import { Injector, type Provider } from "@angular/core";
import { describe, expect, it } from "vitest";

import { MessageContentBlockKinds } from "@opencrane/models/conversations";
import { PersonaFirstChatArchetypes } from "@opencrane/models/user-onboarding";
import { ConversationEventStreamMessageError } from "@opencrane/state/conversation/stream";
import { CONVERSATION_WORKSPACE_EVENT_STREAM, CONVERSATION_WORKSPACE_GATEWAY, type ConversationWorkspaceGateway } from "@opencrane/state/conversation/workspace";

import { provideLocalDevelopmentGateways } from "../local-development.providers";
import { LOCAL_DEVELOPMENT_ARCHETYPE } from "../local-development-archetype";
import { LOCAL_DEVELOPMENT_SCENARIO } from "../local-development-scenario";
import { LocalDevelopmentScenarioKinds } from "../local-development-scenario.types";

function _Providers(): Provider[]
{
	return [
		...provideLocalDevelopmentGateways(),
		{ provide: LOCAL_DEVELOPMENT_ARCHETYPE, useValue: PersonaFirstChatArchetypes.Commander },
		{ provide: LOCAL_DEVELOPMENT_SCENARIO, useValue: LocalDevelopmentScenarioKinds.HappyPath }
	];
}

describe("LocalDevelopmentConversationEventStream.submit", function _Suite()
{
	it("admits the message into the shared local workspace", async function _Submit()
	{
		const injector = Injector.create({ providers: _Providers() });
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
		const stream = Injector.create({ providers: _Providers() }).get(CONVERSATION_WORKSPACE_EVENT_STREAM);

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

	it("admits an exact retry only once", async function _ExactRetry()
	{
		const injector = Injector.create({ providers: _Providers() });
		const stream = injector.get(CONVERSATION_WORKSPACE_EVENT_STREAM);
		const workspace = injector.get<ConversationWorkspaceGateway>(CONVERSATION_WORKSPACE_GATEWAY);
		const before = await workspace.open("conversation-agent");
		const command = {
			conversationId: before.id,
			idempotencyKey: "stream-message-local-retry",
			blocks: [
				{
					id: "stream-block-local-retry",
					kind: MessageContentBlockKinds.Text,
					value: "Keep this retry stable."
				}
			]
		};

		await stream.submit(command);
		await stream.submit(command);

		expect((await workspace.open(before.id)).messages).toHaveLength(before.messages.length + 2);
	});

	it("rejects a message key reused for different input", async function _ChangedRetry()
	{
		const stream = Injector.create({ providers: _Providers() }).get(CONVERSATION_WORKSPACE_EVENT_STREAM);
		const command = {
			conversationId: "conversation-agent",
			idempotencyKey: "stream-message-local-conflict",
			blocks: [
				{
					id: "stream-block-local-conflict",
					kind: MessageContentBlockKinds.Text,
					value: "Original participant input."
				}
			]
		};

		await stream.submit(command);

		const changedRetry = stream.submit({
			...command,
			blocks: [{ ...command.blocks[0], value: "Different participant input." }]
		});

		await expect(changedRetry).rejects.toBeInstanceOf(ConversationEventStreamMessageError);
		await expect(changedRetry).rejects.toMatchObject({ accessChanged: false, closed: false });
	});
});
