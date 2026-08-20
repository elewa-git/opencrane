import { describe, expect, it } from "vitest";

import { CONVERSATION_WORKSPACE_EVENT_STREAM, CONVERSATION_WORKSPACE_GATEWAY } from "@opencrane/state/conversation/workspace";
import { OpenCraneConversationWorkspaceGateway } from "@opencrane/state/conversation/workspace/adapter";
import { OpenCraneConversationEventStream } from "@opencrane/state/conversation/adapter";
import { CONVERSATION_ASSETS_GATEWAY, OpenCraneConversationAssetsGateway } from "@opencrane/state/conversation/assets";

import { provideConversationWorkspaceComposition } from "../conversation-workspace.providers";

describe("Conversation workspace app providers", function _ConversationWorkspaceAppProviders()
{
	it("binds typed workspace, stream, and asset ports to concrete web adapters", function _TypedBindings()
	{
		expect(provideConversationWorkspaceComposition()).toEqual(expect.arrayContaining([
			OpenCraneConversationEventStream,
			{ provide: CONVERSATION_WORKSPACE_GATEWAY, useClass: OpenCraneConversationWorkspaceGateway },
			{ provide: CONVERSATION_WORKSPACE_EVENT_STREAM, useExisting: OpenCraneConversationEventStream },
			{ provide: CONVERSATION_ASSETS_GATEWAY, useClass: OpenCraneConversationAssetsGateway }
		]));
	});
});
