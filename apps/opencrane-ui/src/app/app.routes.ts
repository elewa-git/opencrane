import { Routes } from "@angular/router";

import { ___OperatorAccessGuard } from "./operator-access.guard";

/**
 * Top-level route table; feature pages are lazy-loaded route containers.
 *
 * Every entry loads its component or child routes on demand, so no feature is in the initial bundle.
 * Order matters here: Angular tries these in declaration order and takes the first that matches, so
 * the first-class Agent-thread route stays above the conversation workspace mount.
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
		// Organization settings shell; the feature exposes only backed child routes.
		path: "settings",
		canActivate: [___OperatorAccessGuard],
		loadChildren: function loadSettingsRoutes()
		{
			return import("@opencrane/features/settings").then(function pickSettingsRoutes(m)
			{
				return m.SETTINGS_ROUTES;
			});
		}
	},
	{
		// Invitation acceptance requires an identity, but anonymous invitees must first be offered the
		// provider's registration flow. The feature removes its token from browser history before
		// submitting it to organization authority.
		path: "invite",
		data: { registrationOnAnonymous: true },
		canActivate: [___OperatorAccessGuard],
		loadComponent: function loadInvitationAcceptance()
		{
			return import("@opencrane/features/settings").then(function pickInvitationAcceptance(m)
			{
				return m.OrganizationInviteAcceptanceComponent;
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
		// The app owns only the guarded mount. The feature owns selected/index child routes and their
		// navigation lifecycle; app.config.ts selects the gateway profile before this route loads.
		path: "chats",
		canActivate: [___OperatorAccessGuard],
		loadChildren: function loadConversationWorkspaceRoutes()
		{
			return import("@opencrane/features/conversation-workspace").then(function pickConversationWorkspaceRoutes(m)
			{
				return m.CONVERSATION_WORKSPACE_ROUTES;
			});
		}
	},
	{ path: "", pathMatch: "full", redirectTo: "onboarding" },
	{
		path: "**",
		redirectTo: ""
	}
];
