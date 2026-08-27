import { Routes } from "@angular/router";

import { ___OperatorAccessGuard } from "./operator-access.guard";

/**
 * Chooses the first Tier 1 screen without adding a development-only control to the product UI.
 *
 * A plain build keeps the live-looking onboarding journey. An archetype build already selects the
 * local Agent fixture, so it opens that Agent's conversation instead of asking the developer to
 * repeat the deterministic onboarding path.
 *
 * Called by: `_LOCAL_DEVELOPMENT_ENTRY_ROUTE` while this build's route table initializes.
 * @param explicitArchetype - Archetype injected by a named local build, or undefined for plain development.
 * @returns The local route that should receive empty, login, and unsupported URLs.
 */
export function _LocalDevelopmentEntryRoute(explicitArchetype?: string): string
{
	return !explicitArchetype ? "onboarding" : "chats/conversation-agent";
}

/** Stores the build-selected entry route so every Tier 1 redirect makes the same decision. */
const _LOCAL_DEVELOPMENT_ENTRY_ROUTE = _LocalDevelopmentEntryRoute(typeof OPENCRANE_LOCAL_DEVELOPMENT_ARCHETYPE === "undefined"
	? undefined
	: OPENCRANE_LOCAL_DEVELOPMENT_ARCHETYPE);

/**
 * Routes supported by the backend-free Tier 1 development profile.
 *
 * Called by: `appConfig` after the development build replaces the live route table. Unsupported
 * administration, settings, and invitation URLs return to the selected Tier 1 entry route instead
 * of mounting features whose backend-owned gateways are intentionally absent.
 */
export const APP_ROUTES: Routes =
[
	{
		path: "login",
		redirectTo: _LOCAL_DEVELOPMENT_ENTRY_ROUTE
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
	{ path: "", pathMatch: "full", redirectTo: _LOCAL_DEVELOPMENT_ENTRY_ROUTE },
	{ path: "**", redirectTo: _LOCAL_DEVELOPMENT_ENTRY_ROUTE }
];
