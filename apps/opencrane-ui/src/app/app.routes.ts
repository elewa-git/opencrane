import { Routes } from "@angular/router";

import { ___OperatorAccessGuard } from "./operator-access.guard";

/**
 * Top-level route table; feature pages are lazy-loaded route containers.
 *
 * Every entry loads its component or child routes on demand, so no feature is in the initial bundle.
 * Order matters here: Angular tries these in declaration order and takes the first that matches, so
 * the more specific chat routes stay above the bare `chats` index. `_RoutePrecedence` in
 * `chats/__tests__/conversation-workspace-route.state.spec.ts` asserts that order, which means moving
 * a chat entry will fail a test rather than quietly change which screen a URL opens.
 *
 * Every signed-in route carries `___OperatorAccessGuard`; only `login` and the redirects do not,
 * because `login` is where the guard sends anonymous visitors.
 *
 * Called by: `appConfig` in `app.config.ts`, through `provideRouter`.
 *
 * @see ___OperatorAccessGuard for what "signed in" means on this surface.
 */
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
			return import("@opencrane/features/agent-threads").then(function pickAgentThreadRoute(m)
			{
				return m.AgentThreadRouteComponent;
			});
		}
	},
	{
		// Canonical selected-conversation route; the same shell also owns /chats. One component serves
		// both because selecting a conversation does not change the screen, only what is open in it —
		// `withComponentInputBinding()` in app.config.ts delivers :conversationId to the component's
		// `conversationId` input, and the workspace opens it once its list has loaded. Keeping this
		// above the "chats" entry below preserves the declaration order the route spec asserts.
		path: "chats/:conversationId",
		canActivate: [___OperatorAccessGuard],
		loadComponent: function loadConversationWorkspaceRoute()
		{
			return import("./chats/conversation-workspace-route.component.js").then(function pickConversationWorkspaceRoute(m)
			{
				return m.ConversationWorkspaceRouteComponent;
			});
		}
	},
	{
		// Post-onboarding direct, group, and Agent-session workspace index. This is the URL with nothing
		// selected: where archiving the last conversation returns to, and the deliberately
		// non-disclosing destination the Agent-thread route falls back to when its restoration state
		// does not belong to it.
		path: "chats",
		canActivate: [___OperatorAccessGuard],
		loadComponent: function loadConversationWorkspaceRoute()
		{
			return import("./chats/conversation-workspace-route.component.js").then(function pickConversationWorkspaceRoute(m)
			{
				return m.ConversationWorkspaceRouteComponent;
			});
		}
	},
	{ path: "", pathMatch: "full", redirectTo: "onboarding" },
	{
		path: "**",
		redirectTo: ""
	}
];
