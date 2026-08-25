import type { Provider } from "@angular/core";

import type { PersonaFirstChatArchetypes } from "@opencrane/models/user-onboarding";
import { PLATFORM_PREFERENCE_STORE, type PlatformPreferenceStore } from "@opencrane/platform";
import { __ResolveLocalDevelopmentArchetype, LOCAL_DEVELOPMENT_ARCHETYPE, provideLocalDevelopmentGateways } from "@opencrane/state/local-development";

/**
 * Provides the backend-free Tier 1 gateway profile for the default development build.
 *
 * Called by: `appConfig` after Angular replaces the live profile entry point at build time.
 */
export const OPENCRANE_UI_GATEWAY_PROVIDERS: Provider[] = [
	...provideLocalDevelopmentGateways(),
	{
		provide: LOCAL_DEVELOPMENT_ARCHETYPE,
		deps: [PLATFORM_PREFERENCE_STORE],
		useFactory: _ResolveConfiguredArchetype
	}
];

/** Resolve and persist an explicit build selection before any saved browser preference. */
function _ResolveConfiguredArchetype(preferences: PlatformPreferenceStore): PersonaFirstChatArchetypes
{
	const explicitSelection = typeof OPENCRANE_LOCAL_DEVELOPMENT_ARCHETYPE === "undefined"
		? undefined
		: OPENCRANE_LOCAL_DEVELOPMENT_ARCHETYPE;

	return __ResolveLocalDevelopmentArchetype(preferences, explicitSelection);
}
