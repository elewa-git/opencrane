import { describe, expect, it } from "vitest";
import type { Routes } from "@angular/router";

import { APP_ROUTES } from "../app.routes";

describe("OpenCrane app route composition", function _OpenCraneAppRouteComposition()
{
	it("mounts the workspace library after the nested conversation route", function _ConversationRouteOrder()
	{
		const paths = APP_ROUTES.map(function _RoutePath(route) { return route.path; });
		expect(paths.indexOf("chats/:parentConversationId/threads/:childConversationId")).toBeLessThan(paths.indexOf("chats"));
		const workspaceMount = APP_ROUTES.find(function _WorkspaceMount(route) { return route.path === "chats"; });
		expect(workspaceMount?.loadChildren).toBeTypeOf("function");
		expect(workspaceMount?.loadComponent).toBeUndefined();
	});

	it("composes the settings shell, member child and independent governance destinations", async function _ReportingRoutes()
	{
		const settings = APP_ROUTES.find(function _Settings(route) { return route.path === "settings"; });
		const loaded = await settings!.loadChildren!() as Routes;
		const shell = loaded[0];
		expect(shell.component?.name).toBe("SettingsShellComponent");
		expect(shell.children?.find(function _Default(route) { return route.path === "" && route.redirectTo !== undefined; })).toMatchObject({ pathMatch: "full", redirectTo: "members" });
		expect(shell.children?.find(function _Members(route) { return route.path === "members"; })?.component?.name).toBe("MembersRouteComponent");
		const governance = shell.children?.find(function _Governance(route) { return route.loadChildren !== undefined; });
		const children = await governance!.loadChildren!() as Routes;
		expect(children.map(function _Path(route) { return route.path; })).toEqual(["audit", "usage"]);
		expect(children.every(function _Context(route) { return route.providers?.length === 1; })).toBe(true);
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
});
