import { describe, expect, it } from "vitest";

import { APP_ROUTES } from "../app.routes.js";

describe("OpenCrane app route composition", function _OpenCraneAppRouteComposition()
{
	it("mounts the workspace library after the first-class Agent-thread route", function _ConversationRouteOrder()
	{
		const paths = APP_ROUTES.map(function _RoutePath(route) { return route.path; });
		expect(paths.indexOf("chats/:parentConversationId/threads/:childConversationId")).toBeLessThan(paths.indexOf("chats"));
		const workspaceMount = APP_ROUTES.find(function _WorkspaceMount(route) { return route.path === "chats"; });
		expect(workspaceMount?.loadChildren).toBeTypeOf("function");
		expect(workspaceMount?.loadComponent).toBeUndefined();
	});
});
