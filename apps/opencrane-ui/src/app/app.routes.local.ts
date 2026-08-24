import { Routes } from "@angular/router";

import { ___OperatorAccessGuard } from "./operator-access.guard";

/**
 * Routes supported by the backend-free Tier 1 development profile.
 *
 * Called by: `appConfig` after the development build replaces the live route table. Unsupported
 * administration, settings, and invitation URLs return to onboarding instead of mounting features
 * whose backend-owned gateways are intentionally absent.
 */
export const APP_ROUTES: Routes =
[
	{
		path: "login",
		redirectTo: "onboarding"
	},
	{
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
	{ path: "**", redirectTo: "onboarding" }
];
