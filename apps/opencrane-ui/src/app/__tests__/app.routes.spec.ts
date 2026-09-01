import { describe, expect, it } from "vitest";

import { APP_ROUTES } from "../app.routes";
import { _LocalDevelopmentEntryRoute, APP_ROUTES as LOCAL_APP_ROUTES } from "../app.routes.local";

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

	it("guards settings and requests registration only for anonymous token acceptance", function _SettingsRoutes()
	{
		const settings = APP_ROUTES.find(function _Settings(route) { return route.path === "settings"; });
		const invite = APP_ROUTES.find(function _Invite(route) { return route.path === "invite"; });
		expect(settings?.canActivate?.length).toBe(1);
		expect(settings?.loadChildren).toBeTypeOf("function");
		expect(settings?.data?.["registrationOnAnonymous"]).toBeUndefined();
		expect(invite?.canActivate?.length).toBe(1);
		expect(invite?.loadComponent).toBeTypeOf("function");
		expect(invite?.data?.["registrationOnAnonymous"]).toBe(true);
	});

	it("keeps the backend-free route table within the supported onboarding and chat surface", function _LocalRoutes()
	{
		const paths = LOCAL_APP_ROUTES.map(function _RoutePath(route) { return route.path; });
		expect(paths).toContain("onboarding");
		expect(paths).toContain("chats");
		expect(paths).not.toContain("admin");
		expect(paths).not.toContain("settings");
		expect(paths).not.toContain("invite");
		expect(LOCAL_APP_ROUTES.find(function _Login(route) { return route.path === "login"; })?.redirectTo).toBe("onboarding");
		for (const path of ["onboarding", "chats", "chats/:parentConversationId/threads/:childConversationId"])
		{
			const route = LOCAL_APP_ROUTES.find(function _Supported(candidate) { return candidate.path === path; });
			expect(route?.canActivate?.length).toBe(1);
			expect(route?.loadChildren ?? route?.loadComponent).toBeTypeOf("function");
		}
		expect(paths.indexOf("chats/:parentConversationId/threads/:childConversationId")).toBeLessThan(paths.indexOf("chats"));
	});

	it("opens onboarding for a plain build and Agent chat for an archetype build", function _LocalEntryRoute()
	{
		expect(_LocalDevelopmentEntryRoute()).toBe("onboarding");

		for (const archetype of ["commander", "catalyst", "anchor", "analyst"])
		{
			expect(_LocalDevelopmentEntryRoute(archetype)).toBe("chats/conversation-agent");
		}
	});
});
