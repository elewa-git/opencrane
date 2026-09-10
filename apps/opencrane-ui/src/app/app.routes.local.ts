import type { Routes } from "@angular/router";
import type { PersonaFirstChatArchetypes } from "@opencrane/models/user-onboarding";

import { _ConfiguredLocalDevelopmentArchetype } from "./local-development-profile";

/**
 * Chooses the Tier 1 entry screen without adding a development control to the product interface.
 *
 * A plain build always starts the onboarding journey. A named build opens the selected archetype's
 * deterministic personal-Agent conversation directly.
 *
 * @param explicitArchetype - Archetype embedded by a named local build, or undefined for plain local development.
 * @returns The local route used for empty, login, and unsupported URLs.
 */
export function _LocalDevelopmentEntryRoute(explicitArchetype: PersonaFirstChatArchetypes | undefined): string
{
	if (explicitArchetype === undefined)
	{
		return "onboarding";
	}

	return "chats/conversation-agent";
}

/** Stores one entry decision for every redirect in this build. */
const _LOCAL_DEVELOPMENT_ENTRY_ROUTE = _LocalDevelopmentEntryRoute(_ConfiguredLocalDevelopmentArchetype());

/**
 * Routes supported by the backend-free Tier 1 profile.
 *
 * The local profile mounts the current onboarding and chat features without the live authentication
 * guard. Backend-owned administration, settings, invitation, and sign-in routes redirect to the
 * selected local entry because Tier 1 intentionally provides none of their live authority.
 *
 * Called by: `appConfig` after the local build replaces the live route table.
 */
export const APP_ROUTES: Routes =
[
	{
		path: "login",
		redirectTo: _LOCAL_DEVELOPMENT_ENTRY_ROUTE
	},
	{
		path: "onboarding",
		loadChildren: function loadOnboardingRoutes()
		{
			return import("@opencrane/features/onboarding").then(function pickOnboardingRoutes(module)
			{
				return module.ONBOARDING_ROUTES;
			});
		}
	},
	{
		path: "chats",
		loadChildren: function loadConversationWorkspaceRoutes()
		{
			return import("@opencrane/features/conversation-workspace").then(function pickConversationWorkspaceRoutes(module)
			{
				return module.CONVERSATION_WORKSPACE_ROUTES;
			});
		}
	},
	{ path: "", pathMatch: "full", redirectTo: _LOCAL_DEVELOPMENT_ENTRY_ROUTE },
	{ path: "**", redirectTo: _LOCAL_DEVELOPMENT_ENTRY_ROUTE }
];
