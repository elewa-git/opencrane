import type { Provider } from "@angular/core";

import { provideLocalDevelopmentGateways } from "@opencrane/state/local-development";

/**
 * Provides the backend-free Tier 1 gateway profile for the default development build.
 *
 * Called by: `appConfig` after Angular replaces the live profile entry point at build time.
 */
export const OPENCRANE_UI_GATEWAY_PROVIDERS: Provider[] = provideLocalDevelopmentGateways();
