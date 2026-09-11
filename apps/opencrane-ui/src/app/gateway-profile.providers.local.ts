import type { Provider } from "@angular/core";

import { provideLocalDevelopmentGateways } from "@opencrane/state/local-development";

import { _BrowserLocalDevelopmentScenario, _ConfiguredLocalDevelopmentArchetype, _ResolveLocalDevelopmentArchetype } from "./local-development-profile";

/** Records whether the plain command must run the complete onboarding journey. */
const _LOCAL_DEVELOPMENT_STARTS_WITH_ONBOARDING = _ConfiguredLocalDevelopmentArchetype() === undefined;

/** Stores the deterministic archetype used by this disposable local profile. */
const _LOCAL_DEVELOPMENT_ARCHETYPE = _ResolveLocalDevelopmentArchetype(_ConfiguredLocalDevelopmentArchetype());

/**
 * Provides the backend-free gateway composition used only by local development builds.
 *
 * Called by: `appConfig` after Angular replaces the live provider entry at build time.
 */
export const OPENCRANE_UI_GATEWAY_PROVIDERS: Provider[] = provideLocalDevelopmentGateways(
	{
		archetype: _LOCAL_DEVELOPMENT_ARCHETYPE,
		startWithOnboarding: _LOCAL_DEVELOPMENT_STARTS_WITH_ONBOARDING,
		scenario: _BrowserLocalDevelopmentScenario()
	}
);
