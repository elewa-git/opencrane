import type { Provider } from "@angular/core";

import { provideOpenCraneUiLiveGateways } from "@opencrane/state/gateways";

/**
 * Provides the live gateway profile used by development-live and production builds.
 *
 * Called by: `appConfig`; the default development build replaces this module with the local entry
 * point so production never imports development fixtures.
 */
export const OPENCRANE_UI_GATEWAY_PROVIDERS: Provider[] = provideOpenCraneUiLiveGateways();
