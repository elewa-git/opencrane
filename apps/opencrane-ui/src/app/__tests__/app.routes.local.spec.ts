import { describe, expect, it } from "vitest";

import { PersonaFirstChatArchetypes } from "@opencrane/models/user-onboarding";

import { APP_ROUTES, _LocalDevelopmentEntryRoute } from "../app.routes.local";

describe("Tier 1 local routes", function _TierOneLocalRoutes()
{
	it("starts a plain build in onboarding and a named build in its personal-Agent conversation", function _LocalEntryRoutes()
	{
		expect(_LocalDevelopmentEntryRoute(undefined)).toBe("onboarding");
		expect(_LocalDevelopmentEntryRoute(PersonaFirstChatArchetypes.Commander)).toBe("chats/conversation-agent");
		expect(_LocalDevelopmentEntryRoute(PersonaFirstChatArchetypes.Catalyst)).toBe("chats/conversation-agent");
		expect(_LocalDevelopmentEntryRoute(PersonaFirstChatArchetypes.Anchor)).toBe("chats/conversation-agent");
		expect(_LocalDevelopmentEntryRoute(PersonaFirstChatArchetypes.Analyst)).toBe("chats/conversation-agent");
	});

	it("mounts only onboarding and chats without the live authentication guard", function _SupportedRoutes()
	{
		const mountedRoutes = APP_ROUTES.filter(route => Boolean(route.loadChildren));
		expect(mountedRoutes.map(route => route.path)).toEqual(["onboarding", "chats"]);
		expect(mountedRoutes.every(route => !route.canActivate)).toBe(true);
		expect(APP_ROUTES.some(route => route.path === "admin"
			|| route.path === "settings"
			|| route.path === "invite")).toBe(false);
	});
});
