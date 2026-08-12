import { Routes } from "@angular/router";

import { ___OperatorAccessGuard } from "./operator-access.guard";

/** Top-level route table; feature pages are lazy-loaded route containers. */
export const APP_ROUTES: Routes =
[
	{
		// Public sign-in landing. No access guard — this is the destination the
		// guard sends anonymous visitors to.
		path: "login",
		loadComponent: function loadLoginPage()
		{
			return import("./login/login-page.component").then(function pickLoginPage(m)
			{
				return m.LoginPageComponent;
			});
		}
	},
	{
		// Server-authoritative persona lifecycle and bounded first-chat journey.
		path: "onboarding",
		canActivate: [___OperatorAccessGuard],
		loadChildren: function loadOnboardingRoutes()
		{
			return import("@opencrane/features/onboarding").then(function pickOnboardingRoutes(m)
			{
				return m.ONBOARDING_ROUTES;
			});
		}
	},
	{
		// MCP admin console (catalogue governance + access policy). Each screen
		// gates in-component on the customerAdmin capability.
		path: "admin",
		canActivate: [___OperatorAccessGuard],
		loadChildren: function loadMcpAdminRoutes()
		{
			return import("@opencrane/features/tools").then(function pickMcpAdminRoutes(m)
			{
				return m.MCP_ADMIN_ROUTES;
			});
		}
	},
	{
		// Canonical first-class Agent-session child conversation route. The parent
		// workspace from #351 will write exact focus and scroll restoration state.
		path: "chats/:parentConversationId/threads/:childConversationId",
		canActivate: [___OperatorAccessGuard],
		loadComponent: function loadAgentThreadRoute()
		{
			return import("./agent-thread/agent-thread-route.component").then(function pickAgentThreadRoute(m)
			{
				return m.AgentThreadRouteComponent;
			});
		}
	},
	{
		// Non-disclosing fallback. #351 replaces this component with the complete
		// direct/group conversation workspace without changing child URLs.
		path: "chats",
		canActivate: [___OperatorAccessGuard],
		loadComponent: function loadChatsPending()
		{
			return import("./chats/chats-pending.component").then(function pickChatsPending(m)
			{
				return m.ChatsPendingComponent;
			});
		}
	},
	{ path: "", pathMatch: "full", redirectTo: "onboarding" },
	{
		path: "**",
		redirectTo: ""
	}
];
