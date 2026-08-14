import { describe, expect, it } from "vitest";

import { _ConversationRouteCommands, _ConversationThreadRouteNavigation } from "../conversation-workspace-route.state.js";

describe("Conversation workspace route composition", function _ConversationWorkspaceRouteComposition()
{
	it("keeps selected conversations on the canonical chat URL", function _SelectedConversationRoute()
	{
		expect(_ConversationRouteCommands("conversation-1")).toEqual(["/chats", "conversation-1"]);
		expect(_ConversationRouteCommands(null)).toEqual(["/chats"]);
	});

	it("carries exact breadcrumb restoration into a child Agent thread", function _ChildThreadRoute()
	{
		expect(_ConversationThreadRouteNavigation({ parentConversationId: "group-1", childConversationId: "child-1", parentMessageId: "message-1" })).toEqual({
			commands: ["/chats", "group-1", "threads", "child-1"],
			extras: { state: { parentRestore: { parentConversationId: "group-1", parentMessageId: "message-1", parentScrollAnchor: "message-1" } } }
		});
	});
});
