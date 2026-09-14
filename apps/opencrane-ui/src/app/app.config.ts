import { ApplicationConfig, provideBrowserGlobalErrorListeners, provideZonelessChangeDetection } from "@angular/core";
import { provideRouter, withComponentInputBinding } from "@angular/router";
import { provideAnimationsAsync } from "@angular/platform-browser/animations/async";
import { provideHttpClient, withFetch } from "@angular/common/http";
import { providePrimeNG } from "primeng/config";

import { OpenCranePreset } from "@opencrane/core";
import { PLATFORM_SURFACE } from "@opencrane/state/core";
import { provideWebPlatform } from "@opencrane/platform";

import { APP_ROUTES } from "./app.routes";
import { OPENCRANE_UI_GATEWAY_PROVIDERS } from "./gateway-profile.providers";

/**
 * Root application configuration for the OpenCrane frontend.
 *
 * Change detection is zoneless: the app is fully signal-driven with OnPush
 * components, so zone.js is not bundled (see the empty polyfills in the build).
 * The web PlatformBridge is provided here; a desktop app swaps in its own.
 *
 * `withComponentInputBinding()` is load-bearing rather than decorative: route
 * parameters such as :conversationId reach a route component as a signal input
 * instead of the component reading ActivatedRoute, so a route component can stay
 * a thin coordinator. Removing it silently leaves those inputs undefined.
 *
 * `APP_ROUTES` and `OPENCRANE_UI_GATEWAY_PROVIDERS` are build-time composition entries. Local
 * development replaces both modules, while production and development-live retain the live entries.
 * Keeping that choice at the build boundary prevents local fixture code from entering live bundles.
 *
 * Called by: `bootstrapApplication` in src/main.ts.
 */
export const appConfig: ApplicationConfig =
{
	providers:
	[
		provideBrowserGlobalErrorListeners(),
		provideZonelessChangeDetection(),
		provideRouter(APP_ROUTES, withComponentInputBinding()),
		provideHttpClient(withFetch()),
		provideAnimationsAsync(),
		providePrimeNG({ theme: { preset: OpenCranePreset } }),
		provideWebPlatform(),
		...OPENCRANE_UI_GATEWAY_PROVIDERS,
		// This app is the org/customer surface — capabilities derive from the
		// org-admin claim only (platform-operator claims grant nothing here).
		{ provide: PLATFORM_SURFACE, useValue: "org" },
	]
};
