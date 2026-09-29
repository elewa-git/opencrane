import { describe, expect, it } from "vitest";

import { _RoutineRouteCommands } from "../conversation-workspace-route.state";

describe("conversation workspace routine navigation", function _ConversationWorkspaceRoutineNavigation()
{
	it("uses the selected conversation as the exact routine destination", function _SelectedDestination()
	{
		expect(_RoutineRouteCommands("conversation-current")).toEqual([
			["/routines", "new"],
			{ queryParams: { destination: "conversation-current" } }
		]);
	});
});
