import { ApplicationConfig, provideBrowserGlobalErrorListeners, provideZonelessChangeDetection } from "@angular/core";
import { provideRouter, withComponentInputBinding } from "@angular/router";
import { provideAnimationsAsync } from "@angular/platform-browser/animations/async";
import { provideHttpClient, withFetch } from "@angular/common/http";
import { providePrimeNG } from "primeng/config";

import { OpenCranePreset } from "@opencrane/core";
import { provideOpenCraneA2ui } from "@opencrane/elements/a2ui";
import { toSanitizedMarkdownHtml } from "@opencrane/state/conversation/render";
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
 * `APP_ROUTES` and `OPENCRANE_UI_GATEWAY_PROVIDERS` are build entry points. The default
 * development build replaces both with Tier 1 versions, while development-live and production keep
 * these live entries; selecting them at build time keeps local fixtures out of live bundles.
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
		// A2UI renders agent output but does not select a data source, so both profiles share this setup.
		...provideOpenCraneA2ui(toSanitizedMarkdownHtml),
		// This app is the org/customer surface — capabilities derive from the
		// org-admin claim only (platform-operator claims grant nothing here).
		{ provide: PLATFORM_SURFACE, useValue: "org" },
	]
};
